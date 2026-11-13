import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "../../../test/utils/git-fixture.ts";
import { prepareReview } from "../../../test/utils/input.ts";
import { mergePass } from "./coverage.ts";
import type { WorkerResult } from "./types.ts";

const review = (t: Parameters<typeof fixture>[0]) => {
  const f = fixture(t);
  for (const name of ["a.ts", "b.ts", "c.ts"])
    f.write(name, `export const ${name[0]} = 1;\n`);
  return prepareReview(
    [
      "--scope",
      "repository",
      "--task",
      "Review",
      "--aspects",
      "low-value-comments",
      ...["a.ts", "b.ts", "c.ts"].flatMap((p) => ["--path", p]),
    ],
    f.root,
  );
};

const result = (
  examinedPaths: string[],
  limitations: string[],
  extra: Partial<WorkerResult> = {},
): WorkerResult => ({
  aspect: "low-value-comments",
  status: "no-findings",
  findings: [],
  limitations,
  examinedPaths,
  ...extra,
});

test("portion limitations survive later portions and name their portion", (t) => {
  const input = review(t);
  const first = mergePass(
    input,
    null,
    result(["a.ts"], ["The one assessed path is a.ts."]),
    false,
    false,
    { index: 1, paths: 1 },
  );
  assert.match(first.limitations[0] ?? "", /^Unexamined assessed paths \(/);
  const merged = mergePass(
    input,
    first,
    result(["b.ts", "c.ts"], ["The two assessed paths are b.ts and c.ts."]),
    false,
    false,
    { index: 2, paths: 2 },
  );
  assert.equal(merged.status, "no-findings");
  assert.deepEqual(merged.limitations, [
    "Portion 1 (1 path): The one assessed path is a.ts.",
    "Portion 2 (2 paths): The two assessed paths are b.ts and c.ts.",
  ]);
});

test("a single whole-input pass keeps unlabeled limitations and reason", (t) => {
  const input = review(t);
  const merged = mergePass(
    input,
    null,
    result(["a.ts"], ["Turn budget used."], {
      status: "incomplete",
      reason: "Ran out of turns.",
    }),
  );
  assert.equal(merged.reason, "Ran out of turns.");
  assert.deepEqual(merged.limitations, [
    "Unexamined assessed paths (2): b.ts, c.ts.",
    "Turn budget used.",
  ]);
});

test("distinct portion reasons are combined, repeated ones kept once", (t) => {
  const input = review(t);
  const incomplete = (paths: string[], reason: string) =>
    result(paths, [], { status: "incomplete", reason });
  const first = mergePass(
    input,
    null,
    incomplete(["a.ts"], "Callers unread."),
    false,
    false,
    { index: 1, paths: 1 },
  );
  const second = mergePass(
    input,
    first,
    incomplete(["b.ts"], "Budget exhausted."),
    false,
    false,
    { index: 2, paths: 1 },
  );
  const third = mergePass(
    input,
    second,
    incomplete(["c.ts"], "Budget exhausted."),
    false,
    false,
    { index: 3, paths: 1 },
  );
  assert.equal(
    third.reason,
    "Portion 1 (1 path): Callers unread. Portion 2 (1 path): Budget exhausted.",
  );
});
