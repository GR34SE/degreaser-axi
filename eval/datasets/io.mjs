import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
export const ordered = (values) =>
  [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

export function safePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    isAbsolute(value) ||
    /[\\:\p{Cc}\p{Cf}]/u.test(value) ||
    value
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /^\.git(?:[. ]|$)/iu.test(part) ||
          /^git~\d/iu.test(part),
      )
  ) {
    throw new Error(`Unsafe source path: ${JSON.stringify(value)}`);
  }
  return value;
}

export function assertRealPath(path) {
  const absolute = resolve(path);
  let current = absolute;
  while (true) {
    const info = lstatSync(current);
    if (info.isSymbolicLink()) throw new Error(`Symlink rejected: ${current}`);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return absolute;
}

export class SourceReader {
  constructor(root) {
    this.root = assertRealPath(root);
    this.files = new Map();
  }
  path(name) {
    return assertRealPath(join(this.root, safePath(name)));
  }
  read(name) {
    const path = this.path(name);
    if (!lstatSync(path).isFile())
      throw new Error(`Not a regular source file: ${name}`);
    const data = readFileSync(path);
    this.files.set(name, {
      path: name,
      bytes: data.length,
      sha256: sha256(data),
    });
    return data;
  }
  json(name) {
    return JSON.parse(this.read(name).toString("utf8"));
  }
  jsonl(name) {
    return this.read(name)
      .toString("utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }
  entries(name) {
    return ordered(readdirSync(this.path(name)));
  }
  tree(name) {
    const files = new Map();
    const walk = (directory) => {
      for (const entry of this.entries(directory)) {
        const path = safePath(`${directory}/${entry}`);
        const info = lstatSync(this.path(path));
        if (info.isDirectory()) walk(path);
        else if (info.isFile())
          files.set(relative(name, path), this.read(path));
        else throw new Error(`Non-regular source entry: ${path}`);
      }
    };
    walk(name);
    return files;
  }
}

export function git(directory, args, input) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ])
    delete env[key];
  // Fixed dates make generated objects repeatable; configured authorship is untouched.
  env.GIT_AUTHOR_DATE = "2000-01-01T00:00:00Z";
  env.GIT_COMMITTER_DATE = env.GIT_AUTHOR_DATE;
  return execFileSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-C", directory, ...args],
    {
      input,
      env,
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}

export function gitTree(directory, revision) {
  const files = new Map();
  const entries = git(directory, ["ls-tree", "-rz", "--full-tree", revision])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  for (const entry of entries) {
    const [header, path] = entry.split("\t");
    safePath(path);
    const [mode, kind, oid] = header.split(" ");
    // Project source, tests and tooling are context, never executed.
    if (
      !/^(?:src|test|tools|scripts|bin)\//u.test(path) &&
      path !== "AGENTS.md"
    )
      continue;
    if (kind !== "blob" || !["100644", "100755"].includes(mode)) {
      throw new Error(`Unsupported Git entry: ${path}`);
    }
    files.set(path, git(directory, ["cat-file", "blob", oid]));
  }
  return files;
}

function treeObject(directory, files) {
  const root = new Map();
  for (const [path, content] of files) {
    const parts = safePath(path).split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.has(part)) node.set(part, new Map());
      node = node.get(part);
      if (!(node instanceof Map))
        throw new Error(`Source path collision: ${path}`);
    }
    node.set(
      parts.at(-1),
      git(directory, ["hash-object", "-w", "--stdin", "--no-filters"], content)
        .toString("utf8")
        .trim(),
    );
  }
  const store = (node) => {
    const entries = ordered(node.keys()).map((name) => {
      const value = node.get(name);
      return value instanceof Map
        ? `040000 tree ${store(value)}\t${name}\0`
        : `100644 blob ${value}\t${name}\0`;
    });
    return git(directory, ["mktree", "-z"], entries.join(""))
      .toString("utf8")
      .trim();
  };
  return store(root);
}

export function materialize(directory, files, baseFiles) {
  mkdirSync(directory, { recursive: true });
  git(directory, [
    "init",
    "--quiet",
    "--template=",
    "--initial-branch=dataset",
  ]);
  const commit = (contents, parent) =>
    git(
      directory,
      [
        "commit-tree",
        treeObject(directory, contents),
        ...(parent ? ["-p", parent] : []),
      ],
      "Source-only evaluation snapshot\n",
    )
      .toString("utf8")
      .trim();
  const base = baseFiles ? commit(baseFiles) : undefined;
  const head = commit(files, base);
  git(directory, ["update-ref", "refs/heads/dataset", head]);
  git(directory, ["read-tree", head]);
  // No checkout, filters, hooks, archive permissions, or third-party code execution.
  for (const [path, content] of files) {
    const target = join(directory, safePath(path));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { flag: "wx", mode: 0o600 });
  }
  return { directory, head, ...(base ? { base } : {}) };
}
