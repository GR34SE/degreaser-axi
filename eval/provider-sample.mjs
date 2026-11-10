import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { git } from "./provider-process.mjs";

const OMIT = new Set([
  ".git",
  ".degreaser",
  ".degreaserrc.json",
  "eval",
  "node_modules",
  ".agents",
  ".claude",
  ".codex",
  ".cursor",
  ".pi",
  ".mcp.json",
  ".DS_Store",
  "samples.jsonl",
]);
const included = (path) =>
  !OMIT.has(path.split("/")[0]) && !path.startsWith("test/eval/");

function safePath(root, path) {
  const destination = join(root, path);
  const rel = relative(root, destination);
  if (
    !rel ||
    rel.startsWith(`..${sep}`) ||
    rel === ".." ||
    isAbsolute(rel) ||
    path.split("/").some((part) => part === ".git")
  ) {
    throw new Error("Unsafe source path in evaluation sample.");
  }
  return destination;
}

async function tree(source, ref, options) {
  const entries = (
    await git(source, ["ls-tree", "-rz", "--full-tree", ref], options)
  )
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
      if (!match) throw new Error("Invalid source tree.");
      return { mode: match[1], type: match[2], oid: match[3], path: match[4] };
    })
    .filter((entry) => included(entry.path));
  if (
    entries.some(
      (e) => e.type !== "blob" || !["100644", "100755"].includes(e.mode),
    )
  ) {
    throw new Error("Evaluation source symlinks and gitlinks are unsupported.");
  }
  if (!entries.length) return [];
  const data = await git(source, ["cat-file", "--batch"], {
    ...options,
    input: `${entries.map((e) => e.oid).join("\n")}\n`,
  });
  let offset = 0;
  return entries.map((entry) => {
    const end = data.indexOf(10, offset);
    const header = data.subarray(offset, end).toString().split(" ");
    const length = Number(header[2]);
    if (
      header[0] !== entry.oid ||
      header[1] !== "blob" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      end < offset ||
      end + length + 1 >= data.length
    ) {
      throw new Error("Invalid source blob.");
    }
    const content = data.subarray(end + 1, end + 1 + length);
    offset = end + length + 2;
    return { path: entry.path, mode: entry.mode, content };
  });
}

async function workingTree(source, options) {
  const paths = (
    await git(
      source,
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      options,
    )
  )
    .toString()
    .split("\0")
    .filter(Boolean);
  const files = [];
  let bytes = 0;
  for (const path of [...new Set(paths)].filter(included).sort()) {
    const file = safePath(source, path);
    let stat;
    try {
      stat = await lstat(file);
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error.code)) continue;
      throw error;
    }
    if (stat.isDirectory()) continue;
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(
        "Evaluation source symlinks and gitlinks are unsupported.",
      );
    }
    bytes += stat.size;
    if (bytes > 134217728)
      throw new Error("Evaluation source exceeds 128 MiB.");
    safePath(source, relative(source, await realpath(file)));
    files.push({
      path,
      mode: stat.mode & 0o111 ? "100755" : "100644",
      content: await readFile(file),
    });
  }
  return files;
}

async function replaceFiles(root, files) {
  for (const entry of await readdir(root)) {
    if (entry !== ".git")
      await rm(join(root, entry), { recursive: true, force: true });
  }
  for (const file of files) {
    const path = safePath(root, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
    await chmod(path, file.mode === "100755" ? 0o755 : 0o644);
  }
}

async function snapshot(source, root, original, parent, options) {
  await git(root, ["add", "--all", "--force", "--", "."], options);
  const oid = (await git(root, ["write-tree"], options)).toString().trim();
  const commit = (
    await git(source, ["cat-file", "commit", original], options)
  ).toString();
  const identities = commit
    .split("\n\n")[0]
    .split("\n")
    .filter((line) => /^(author|committer) /.test(line));
  if (identities.length !== 2)
    throw new Error("Invalid source commit identities.");
  // Copy source attribution, without changing Git identity or retaining source history/labels.
  return (
    await git(root, ["hash-object", "-t", "commit", "-w", "--stdin"], {
      ...options,
      input: `tree ${oid}\n${parent ? `parent ${parent}\n` : ""}${identities.join("\n")}\n\nEvaluation source snapshot\n`,
    })
  )
    .toString()
    .trim();
}

export async function materialize(sample, root, options) {
  const source = await realpath(sample.repo.directory);
  const top = (await git(source, ["rev-parse", "--show-toplevel"], options))
    .toString()
    .trim();
  if ((await realpath(top)) !== source)
    throw new Error("Sample directory must be the Git root.");
  const head = (
    await git(source, ["rev-parse", "--verify", "HEAD^{commit}"], options)
  )
    .toString()
    .trim();
  const base =
    sample.review.scope === "branch"
      ? (await git(source, ["merge-base", head, sample.review.base], options))
          .toString()
          .trim()
      : head;
  const oldFiles = await tree(source, base, options);
  const headFiles =
    base === head ? oldFiles : await tree(source, head, options);
  const finalFiles = await workingTree(source, options);
  await git(root, ["init", "--initial-branch=main", "--template="], options);
  await replaceFiles(root, oldFiles);
  let commit = await snapshot(source, root, base, null, options);
  if (base !== head) {
    await replaceFiles(root, headFiles);
    commit = await snapshot(source, root, head, commit, options);
  }
  const baseRef =
    base === head
      ? commit
      : (await git(root, ["rev-parse", `${commit}^`], options))
          .toString()
          .trim();
  await git(root, ["update-ref", "refs/heads/main", commit], options);
  await git(
    root,
    ["update-ref", "refs/heads/evaluation-base", baseRef],
    options,
  );
  await replaceFiles(root, finalFiles);
  await mkdir(join(root, ".git/info"), { recursive: true });
  await writeFile(
    join(root, ".git/info/exclude"),
    "/.degreaser/\n/.degreaserrc.json\n",
  );
  const hash = createHash("sha256").update(
    JSON.stringify({
      id: sample.id,
      aspects: sample.aspects,
      review: {
        ...sample.review,
        base: sample.review.scope === "branch" ? base : null,
      },
    }),
  );
  for (const files of [oldFiles, headFiles, finalFiles]) {
    for (const file of files) {
      hash
        .update(JSON.stringify([file.path, file.mode, file.content.length]))
        .update(file.content);
    }
    hash.update("\0");
  }
  return { sampleHash: hash.digest("hex"), base: "evaluation-base" };
}
