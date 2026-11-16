import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type BlockKind = "removed" | "kept" | "ambiguous";
export type Block = {
  path: string;
  startLine: number;
  endLine: number;
  kind: BlockKind;
};
export type Finding = {
  path: string;
  startLine: number;
  endLine: number;
  verdict?: "upheld" | "refuted" | "unverified";
};
export type Score = {
  removedTotal: number;
  removedHit: number;
  recall: number;
  truePositives: number;
  falsePositives: number;
  unscored: number;
  precision: number;
  missed: Block[];
  wrong: Finding[];
};

const SOURCE = /\.(ts|mjs|js)$/;
const COMMENT = /^(\/\/|\/\*|\*)/;
const DIRECTIVE = /eslint-|biome-ignore|@ts-/;

const git = (repository: string, ...args: string[]) =>
  execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 256 * 1024 * 1024,
  });

const existsAt = (repository: string, commit: string, path: string) => {
  try {
    git(repository, "cat-file", "-e", `${commit}:${path}`);
    return true;
  } catch {
    return false;
  }
};

type Deletions = { deleted: Set<number>; rewritten: Set<number> };

function deletedLines(diff: string) {
  const byPath = new Map<string, Deletions>();
  let current: Deletions | undefined;
  let hunk: number[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("--- ")) {
      const path = line.slice(4).split("\t")[0] ?? "";
      current = path.startsWith("a/")
        ? { deleted: new Set(), rewritten: new Set() }
        : undefined;
      if (current) byPath.set(path.slice(2), current);
      hunk = [];
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++ ")) {
      if (COMMENT.test(line.slice(1).trim()))
        for (const n of hunk) current?.rewritten.add(n);
      continue;
    }
    const header = /^@@ -(\d+)(?:,(\d+))? /.exec(line);
    if (!header || !current) continue;
    const start = Number(header[1]);
    const count = header[2] === undefined ? 1 : Number(header[2]);
    hunk = Array.from({ length: count }, (_, i) => start + i);
    for (const n of hunk) current.deleted.add(n);
  }
  return byPath;
}

type CommentLine = { number: number; text: string };

function commentBlocks(source: string): CommentLine[][] {
  const blocks: CommentLine[][] = [];
  let open: CommentLine[] = [];
  source.split("\n").forEach((text, index) => {
    if (COMMENT.test(text.trim())) {
      open = [...open, { number: index + 1, text }];
      return;
    }
    if (open.length > 0) blocks.push(open);
    open = [];
  });
  if (open.length > 0) blocks.push(open);
  return blocks;
}

function classify(
  lines: CommentLine[],
  deletions: Deletions | undefined,
  survives: boolean,
): BlockKind {
  if (!survives || lines.some((l) => DIRECTIVE.test(l.text)))
    return "ambiguous";
  const gone = lines.filter((l) => deletions?.deleted.has(l.number)).length;
  if (gone === 0) return "kept";
  return gone === lines.length &&
    !lines.some((l) => deletions?.rewritten.has(l.number))
    ? "removed"
    : "ambiguous";
}

const normalize = (path: string) => path.replace(/^\.\//, "");

const within = (path: string, prefixes: readonly string[]) =>
  prefixes.length === 0 ||
  prefixes.some((prefix) => normalize(path).startsWith(prefix));

export function groundTruth(
  repository: string,
  commit: string,
  prefixes: readonly string[] = [],
): Block[] {
  const parent = `${commit}^`;
  const deleted = deletedLines(
    git(repository, "diff", "-U0", "--no-renames", parent, commit),
  );
  return git(repository, "ls-tree", "-r", "--name-only", parent)
    .split("\n")
    .filter((path) => SOURCE.test(path) && within(path, prefixes))
    .flatMap((path) => {
      const survives = existsAt(repository, commit, path);
      const source = git(repository, "show", `${parent}:${path}`);
      return commentBlocks(source).map((lines) => ({
        path,
        startLine: lines.at(0)?.number ?? 0,
        endLine: lines.at(-1)?.number ?? 0,
        kind: classify(lines, deleted.get(path), survives),
      }));
    });
}

const overlaps = (finding: Finding, block: Block) =>
  normalize(finding.path) === block.path &&
  finding.startLine <= block.endLine &&
  finding.endLine >= block.startLine;

function scoreSet(truth: Block[], findings: Finding[]): Score {
  const hits = findings.map((f) => truth.filter((b) => overlaps(f, b)));
  const has = (kind: BlockKind) => (blocks: Block[]) =>
    blocks.some((b) => b.kind === kind);
  const truePositives = hits.filter(has("removed")).length;
  const wrong = findings.filter((_, i) => {
    const blocks = hits[i] ?? [];
    return !has("removed")(blocks) && has("kept")(blocks);
  });
  const falsePositives = wrong.length;
  const removed = truth.filter((b) => b.kind === "removed");
  const missed = removed.filter(
    (b) => !hits.some((blocks) => blocks.includes(b)),
  );
  const scored = truePositives + falsePositives;
  return {
    removedTotal: removed.length,
    removedHit: removed.length - missed.length,
    recall:
      removed.length === 0
        ? 0
        : (removed.length - missed.length) / removed.length,
    truePositives,
    falsePositives,
    unscored: findings.length - scored,
    precision: scored === 0 ? 0 : truePositives / scored,
    missed,
    wrong,
  };
}

export function score(
  truth: Block[],
  allFindings: Finding[],
  options: { verdicts: boolean; prefixes?: readonly string[] },
) {
  const findings = allFindings.filter((f) =>
    within(f.path, options.prefixes ?? []),
  );
  const all = scoreSet(truth, findings);
  if (!options.verdicts) return { all };
  const upheld = findings.filter(
    (f) => f.verdict === undefined || f.verdict === "upheld",
  );
  return { all, upheld: scoreSet(truth, upheld) };
}

const row = (label: string, s: Score) =>
  `${label.padEnd(8)} recall ${s.removedHit}/${s.removedTotal} (${s.recall.toFixed(2)})  TP ${s.truePositives}  FP ${s.falsePositives}  unscored ${s.unscored}  precision ${s.precision.toFixed(2)}`;

const span = (x: { path: string; startLine: number; endLine: number }) =>
  `  ${x.path}:${x.startLine}-${x.endLine}`;

export function report(
  truth: Block[],
  findings: Finding[],
  prefixes: readonly string[] = [],
) {
  const hasVerdicts = findings.some((f) => f.verdict !== undefined);
  const scores = score(truth, findings, { verdicts: hasVerdicts, prefixes });
  const count = (kind: BlockKind) =>
    truth.filter((b) => b.kind === kind).length;
  return [
    `blocks: removed ${count("removed")}, kept ${count("kept")}, ambiguous ${count("ambiguous")}; findings ${scores.all.unscored + scores.all.truePositives + scores.all.falsePositives}`,
    row("all", scores.all),
    ...(scores.upheld ? [row("upheld", scores.upheld)] : []),
    "missed removed blocks (first 15):",
    ...scores.all.missed.slice(0, 15).map(span),
    "false positives (first 15):",
    ...scores.all.wrong.slice(0, 15).map(span),
  ].join("\n");
}

if (import.meta.main) {
  const [repository, commit, exported, ...prefixes] = process.argv.slice(2);
  if (!repository || !commit || !exported)
    throw new Error(
      "Usage: node test/live/support/cleanup-benchmark.ts <repository> <commit> <export.json> [path-prefix...]",
    );
  const { findings = [] } = JSON.parse(readFileSync(exported, "utf8")) as {
    findings?: Finding[];
  };
  console.log(
    report(groundTruth(repository, commit, prefixes), findings, prefixes),
  );
}
