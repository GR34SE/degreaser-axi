import assert from "node:assert/strict";

import test from "node:test";

import type { Finding } from "../../src/review/ingest/types.ts";

import { queueFixture, until } from "../utils/queue-fixture.ts";

import { decode, finding, result } from "../utils/report-fixture.ts";

test("compiled reports group transitive same-side overlaps with stable evidence ties across completion permutations", async (t) => {
  const f = queueFixture(t);
  const lines = (side: string) =>
    Array.from({ length: 40 }, (_, n) => `${side} line ${n + 1}\n`).join("");
  f.write("source.ts", lines("old"));
  f.git("add", ".");
  f.git("commit", "-m", "Old source coordinates");
  f.write("source.ts", lines("new"));
  f.write("z.ts", "new line 1\n");
  const tie = finding(20);
  const results = [
    result("missed-reuse", [
      finding(1, 4),
      finding(11),
      { ...tie, evidence: "beta" },
      { ...tie, evidence: "alpha" },
      finding(1, 1, "new", "z.ts"),
    ]),
    result("masked-errors", [finding(4, 7), finding(2, 3, "old")]),
    result("low-value-comments", [finding(7, 9), finding(1, 4)]),
  ];
  let previous: unknown;
  for (const order of [
    ["missed-reuse", "masked-errors", "low-value-comments"],
    ["low-value-comments", "masked-errors", "missed-reuse"],
  ]) {
    const prefix = order[0];
    f.setPlan({
      results: Object.fromEntries(
        results.map((r) => [
          r.aspect,
          {
            ...r,
            findings:
              prefix === "low-value-comments"
                ? [...r.findings].reverse()
                : r.findings,
          },
        ]),
      ),
      workers: Object.fromEntries(
        order.map((aspect) => [
          aspect,
          { resultGate: f.gate(`${prefix}-${aspect}`) },
        ]),
      ),
    });
    const started = f.start([
      "--aspects",
      "missed-reuse,masked-errors,low-value-comments",
    ]);
    assert.equal(started.status, 3, started.stdout);
    await until(
      () => f.state().tasks.every((task) => task.attempts.length === 1),
      "All selected workers must be admitted before permuting completion",
    );
    for (const aspect of order) {
      f.release(`${prefix}-${aspect}`);
      await until(
        () =>
          !!f.state().tasks.find((task) => task.assignment.aspect === aspect)
            ?.result,
        `Expected ${aspect} result before releasing its peer`,
      );
    }
    assert.equal(f.finish().status, 0);
    const full = f.run(["report", "--full"]);
    assert.equal(full.status, 0, full.stdout);
    assert.equal(full.stderr, "");
    const report = decode(full.stdout);
    assert.deepEqual(
      report.findings.map(
        (entry: {
          id: string;
          group: string;
          aspect: string;
          location: Finding["location"];
          evidence: string;
        }) => [
          entry.id,
          entry.group,
          entry.aspect,
          entry.location.path,
          entry.location.side,
          entry.location.startLine,
          entry.evidence,
        ],
      ),
      [
        [
          "F1",
          "G1",
          "missed-reuse",
          "source.ts",
          "new",
          1,
          "Evidence at source.ts:new:1",
        ],
        [
          "F2",
          "G1",
          "low-value-comments",
          "source.ts",
          "new",
          1,
          "Evidence at source.ts:new:1",
        ],
        [
          "F3",
          "G1",
          "masked-errors",
          "source.ts",
          "new",
          4,
          "Evidence at source.ts:new:4",
        ],
        [
          "F4",
          "G1",
          "low-value-comments",
          "source.ts",
          "new",
          7,
          "Evidence at source.ts:new:7",
        ],
        [
          "F5",
          "G2",
          "masked-errors",
          "source.ts",
          "old",
          2,
          "Evidence at source.ts:old:2",
        ],
        [
          "F6",
          "G3",
          "missed-reuse",
          "source.ts",
          "new",
          11,
          "Evidence at source.ts:new:11",
        ],
        ["F7", "G4", "missed-reuse", "source.ts", "new", 20, "alpha"],
        ["F8", "G4", "missed-reuse", "source.ts", "new", 20, "beta"],
        [
          "F9",
          "G5",
          "missed-reuse",
          "z.ts",
          "new",
          1,
          "Evidence at z.ts:new:1",
        ],
      ],
    );
    assert.equal(f.run(["report", "--full"]).stdout, full.stdout);
    if (previous) assert.deepEqual(report.findings, previous);
    previous = report.findings;
    const short = decode(f.run(["report"]).stdout);
    assert.deepEqual(
      short.findings.map((entry: { group: string }) => entry.group),
      ["G1", "G1", "G1", "G1", "G2", "G3", "G4", "G4", "G5"],
    );
    const detail = decode(f.run(["finding", "F7", "--run", report.run]).stdout);
    assert.equal(detail.group, "G4");
    assert.equal(detail.evidence, "alpha");
  }
  assert.equal(
    f.events().length,
    6,
    "Grouping/reads must not invoke another reviewer",
  );
});
