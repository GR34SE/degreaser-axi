import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { groundTruth, report, score } from "./support/cleanup-benchmark.ts";

const lines = (...rows: string[]) => `${rows.join("\n")}\n`;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "degreaser-cleanup-bench-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
      { cwd: dir, encoding: "utf8" },
    ).trim();
  git("init", "-q");
  const put = (name: string, text: string) =>
    writeFileSync(join(dir, name), text);
  put(
    "a.ts",
    lines(
      "// remove me",
      "const a = 1;",
      "// half one",
      "// half two",
      "const b = 2;",
      "// keep me",
      "const c = 3;",
      "// eslint-disable-next-line",
      "const d = 4;",
    ),
  );
  put(
    "b.ts",
    lines("// old wording", "const e = 5;", "// swap", "const f = 6;"),
  );
  put("gone.ts", lines("// in deleted file", "export const g = 1;"));
  put("notes.md", lines("// not source", "text"));
  git("add", ".");
  git("commit", "-qm", "base");
  put(
    "a.ts",
    lines(
      "const a = 1;",
      "// half two",
      "const b = 2;",
      "// keep me",
      "const c = 3;",
      "// eslint-disable-next-line",
      "const d = 4;",
    ),
  );
  put("b.ts", lines("// new wording", "const e = 5;", "const f = 7;"));
  unlinkSync(join(dir, "gone.ts"));
  git("add", "-A");
  git("commit", "-qm", "cleanup");
  return { dir, commit: git("rev-parse", "HEAD") };
}

test("ground truth classifies removed, kept and ambiguous blocks", (t) => {
  const { dir, commit } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(groundTruth(dir, commit), [
    { path: "a.ts", startLine: 1, endLine: 1, kind: "removed" },
    { path: "a.ts", startLine: 3, endLine: 4, kind: "ambiguous" },
    { path: "a.ts", startLine: 6, endLine: 6, kind: "kept" },
    { path: "a.ts", startLine: 8, endLine: 8, kind: "ambiguous" },
    { path: "b.ts", startLine: 1, endLine: 1, kind: "ambiguous" },
    { path: "b.ts", startLine: 3, endLine: 3, kind: "removed" },
    { path: "gone.ts", startLine: 1, endLine: 1, kind: "ambiguous" },
  ]);
});

test("path prefixes limit both the ground truth and the scored findings", (t) => {
  const { dir, commit } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const prefixes = ["b", "gone"];
  const truth = groundTruth(dir, commit, prefixes);
  assert.deepEqual(truth, [
    { path: "b.ts", startLine: 1, endLine: 1, kind: "ambiguous" },
    { path: "b.ts", startLine: 3, endLine: 3, kind: "removed" },
    { path: "gone.ts", startLine: 1, endLine: 1, kind: "ambiguous" },
  ]);
  const { all } = score(
    truth,
    [
      { path: "a.ts", startLine: 6, endLine: 6 },
      { path: "./b.ts", startLine: 3, endLine: 3 },
      { path: "b.ts", startLine: 2, endLine: 2 },
    ],
    { verdicts: false, prefixes },
  );
  assert.deepEqual(
    [all.removedHit, all.removedTotal, all.truePositives, all.unscored],
    [1, 1, 1, 1],
  );
});

test("score counts hits once and separates verdicts", (t) => {
  const { dir, commit } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const truth = groundTruth(dir, commit);
  const findings = [
    { path: "a.ts", startLine: 1, endLine: 2 },
    { path: "./a.ts", startLine: 1, endLine: 1, verdict: "refuted" as const },
    { path: "a.ts", startLine: 6, endLine: 6, verdict: "upheld" as const },
    { path: "a.ts", startLine: 3, endLine: 4 },
    { path: "gone.ts", startLine: 1, endLine: 1 },
    { path: "other.ts", startLine: 1, endLine: 1 },
  ];
  const { all, upheld } = score(truth, findings, { verdicts: true });
  assert.deepEqual([all.removedTotal, all.removedHit, all.recall], [2, 1, 0.5]);
  assert.deepEqual(all.wrong, [findings[2]]);
  assert.match(
    report(truth, findings),
    /false positives \(first 15\):\n {2}a\.ts:6-6(\n|$)/,
  );
  assert.deepEqual(
    [all.truePositives, all.falsePositives, all.unscored, all.precision],
    [2, 1, 3, 2 / 3],
  );
  assert.ok(upheld);
  assert.deepEqual(
    [
      upheld.truePositives,
      upheld.falsePositives,
      upheld.unscored,
      upheld.precision,
    ],
    [1, 1, 3, 0.5],
  );
});

test("a missed removed block lowers recall and is listed", (t) => {
  const { dir, commit } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { all } = score(
    groundTruth(dir, commit),
    [{ path: "a.ts", startLine: 6, endLine: 6 }],
    { verdicts: false },
  );
  assert.equal(all.recall, 0);
  assert.deepEqual(all.missed, [
    { path: "a.ts", startLine: 1, endLine: 1, kind: "removed" },
    { path: "b.ts", startLine: 3, endLine: 3, kind: "removed" },
  ]);
  assert.equal(all.precision, 0);
});
