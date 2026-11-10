import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import {
  getLeadingCommentRanges,
  getTrailingCommentRanges,
  type Node,
  SyntaxKind,
} from "typescript/unstable/ast";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import { API } from "typescript/unstable/sync";

export const BEFORE = "b4a1edec03d31b01145b923dc5b4dc0d944de0c9";
export const AFTER = "d232af804ae532c4bd4bf79f56d4d854d7ef2715";
const SOURCES = ["AGENTS.md", "src", "test", "tools"];
const FIXTURES = "test/live/support/comment-fixtures.ts";

export interface Anchor {
  id: string;
  path: string;
  lines: [number, number];
}
export interface Sample {
  id: string;
  split: "dev" | "regression";
  paths: string[];
  report: Anchor[];
  preserve: Anchor[];
}
interface Block {
  text: string;
  start: number;
  end: number;
  single: boolean;
}

export const readJsonLines = <T>(file: string): T[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    maxBuffer: 256 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Degreaser evaluation",
      GIT_AUTHOR_EMAIL: "evaluation@example.invalid",
      GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
      GIT_COMMITTER_NAME: "Degreaser evaluation",
      GIT_COMMITTER_EMAIL: "evaluation@example.invalid",
      GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
    },
  });
const lines = (output: Buffer) =>
  output.toString("utf8").split("\n").filter(Boolean);

function materialize(source: string, revision: string, directory: string) {
  const top = new Set(SOURCES);
  const entries = lines(git(source, "ls-tree", "--name-only", revision));
  mkdirSync(directory);
  execFileSync("tar", ["-x", "-C", directory], {
    input: git(
      source,
      "archive",
      revision,
      "--",
      ...entries.filter((entry) => top.has(entry)),
    ),
    maxBuffer: 256 * 1024 * 1024,
  });
  git(directory, "init", "--quiet", "--template=", "--initial-branch=main");
  mkdirSync(join(directory, ".git/info"));
  writeFileSync(
    join(directory, ".git/info/exclude"),
    "/.degreaser/\n/.degreaserrc.json\n",
  );
  git(directory, "add", "--all", "--force");
  git(directory, "commit", "--quiet", "--no-gpg-sign", "-m", "Source");
}

function blocks(text: string, file: Node) {
  const ranges = new Map<number, { pos: number; end: number; kind: number }>();
  const visit = (node: Node) => {
    for (const range of [
      ...(getLeadingCommentRanges(text, node.pos) ?? []),
      ...(getTrailingCommentRanges(text, node.end) ?? []),
    ])
      ranges.set(range.pos, range);
    node.forEachChild(visit);
  };
  visit(file);
  const line = (offset: number) => text.slice(0, offset).split("\n").length;
  const result: Block[] = [];
  for (const range of [...ranges.values()].sort((a, b) => a.pos - b.pos)) {
    const block = {
      text: text.slice(range.pos, range.end),
      start: line(range.pos),
      end: line(range.end - 1),
      single: range.kind === SyntaxKind.SingleLineCommentTrivia,
    };
    const previous = result.at(-1);
    if (previous?.single && block.single && block.start === previous.end + 1) {
      previous.text += `\n${block.text}`;
      previous.end = block.end;
    } else result.push(block);
  }
  return result;
}

function commentBlocks(files: { path: string; text: string }[]) {
  const names = files.map(
    (file, index) => `/source/${index}${extname(file.path)}`,
  );
  const fs = createVirtualFileSystem({
    "/source/tsconfig.json": JSON.stringify({
      compilerOptions: { noResolve: true, noLib: true, types: [] },
      files: names,
    }),
    ...Object.fromEntries(files.map(({ text }, i) => [names[i], text])),
  });
  const api = new API({
    cwd: "/source",
    fs: { ...fs, readFile: (name) => fs.readFile?.(name) ?? null },
  });
  try {
    const snapshot = api.updateSnapshot({
      openProjects: ["/source/tsconfig.json"],
      openFiles: names,
    });
    return files.map(({ path, text }, index) => {
      const name = names[index] ?? "";
      const program = snapshot.getDefaultProjectForFile(name)?.program;
      const file = program?.getSourceFile(name);
      if (!file || program?.getSyntacticDiagnostics(name).length)
        throw new Error(`Cannot parse ${path}.`);
      return blocks(text, file);
    });
  } finally {
    api.close();
  }
}

function oldRanges(patch: string) {
  return [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? /gmu)].flatMap(
    ([, start = "", count = "1"]) =>
      Number(count)
        ? [[Number(start), Number(start) + Number(count) - 1] as const]
        : [],
  );
}

function label(
  source: string,
  directory: string,
  before: string,
  after: string,
) {
  const tree = (revision: string) =>
    lines(
      git(source, "ls-tree", "-r", "--name-only", revision, "--", ...SOURCES),
    );
  const later = new Set(tree(after));
  const changed = new Set(
    lines(git(source, "diff", "--name-only", before, after)),
  );
  const files = tree(before)
    .filter(
      (path) =>
        /\.[cm]?tsx?$/u.test(path) && later.has(path) && path !== FIXTURES,
    )
    .map((path) => {
      const text = readFileSync(join(directory, path), "utf8");
      if (!changed.has(path)) return { path, text, after: text, ranges: [] };
      const diff = git(
        source,
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--unified=0",
        before,
        after,
        "--",
        path,
      );
      return {
        path,
        text,
        after: git(source, "show", `${after}:${path}`).toString("utf8"),
        ranges: oldRanges(diff.toString("utf8")),
      };
    });
  const parsed = commentBlocks(
    files.flatMap(({ path, text, after }) => [
      { path, text },
      { path, text: after },
    ]),
  );
  return files.map(({ path, ranges }, index) => {
    const anchor = (kind: string, { start, end }: Block): Anchor => ({
      id: `${path}:${kind}${start}-${end}`,
      path,
      lines: [start, end],
    });
    const kept = new Set(parsed[2 * index + 1]?.map((block) => block.text));
    const touched = (line: number) =>
      ranges.some(([start, end]) => line >= start && line <= end);
    const span = ({ start, end }: Block) =>
      Array.from({ length: end - start + 1 }, (_, i) => start + i);
    const comments = parsed[2 * index] ?? [];
    return {
      path,
      report: comments
        .filter((block) => !kept.has(block.text) && span(block).every(touched))
        .map((block) => anchor("", block)),
      preserve: comments
        .filter((block) => kept.has(block.text) && !span(block).some(touched))
        .map((block) => anchor("keep:", block)),
    };
  });
}

const split = (group: string) =>
  Number.parseInt(
    sha256(`degreaser-eval-v1:self-group:${group}`).slice(0, 8),
    16,
  ) %
    10 <
  7
    ? "dev"
    : "regression";

export function deriveDataset(
  output: string,
  source: string,
  before = BEFORE,
  after = AFTER,
) {
  for (const revision of [before, after]) {
    try {
      git(source, "cat-file", "-e", `${revision}^{commit}`);
    } catch {
      throw new Error(
        `Revision ${revision} is missing; fetch the full history of main.`,
      );
    }
  }
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output);
  const repo = join(output, "repo");
  materialize(source, before, repo);
  const groups = new Map<string, { report: Anchor[]; preserve: Anchor[] }>();
  for (const file of label(source, repo, before, after)) {
    if (!file.report.length && !file.preserve.length) continue;
    const group = file.path.split("/").slice(0, 3).join("/");
    const anchors = groups.get(group) ?? { report: [], preserve: [] };
    anchors.report.push(...file.report);
    anchors.preserve.push(...file.preserve);
    groups.set(group, anchors);
  }
  const samples: Sample[] = [...groups]
    .map(
      ([group, { report, preserve }]): Sample => ({
        id: `self/${group}`,
        split: split(group),
        paths: [
          ...new Set([...report, ...preserve].map((anchor) => anchor.path)),
        ].sort(),
        report,
        preserve,
      }),
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  samples.push({
    id: "self/whole-repository",
    split: "regression",
    paths: [],
    report: samples.flatMap((sample) => sample.report),
    preserve: samples.flatMap((sample) => sample.preserve),
  });
  writeFileSync(
    join(output, "samples.jsonl"),
    samples.map((sample) => `${JSON.stringify(sample)}\n`).join(""),
  );
  return samples;
}
