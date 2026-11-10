import assert from "node:assert/strict";
import test from "node:test";
import type { Finding } from "../../src/review/ingest/types.ts";
import type { Anchor } from "./support/dataset.ts";
import { score } from "./support/score.ts";

const anchor = (path: string, start: number, end = start): Anchor => ({
  id: `${path}:${start}-${end}`,
  path,
  lines: [start, end],
});
const finding = (
  startLine: number,
  endLine: number,
  evidence = "The comment restates the code.",
  side: "new" | "old" = "new",
): Finding => ({
  location: { path: "a.ts", side, startLine, endLine },
  quote: "// Return the value.",
  title: "Narrating comment",
  evidence,
  consequence: "Readers learn nothing beyond the code.",
  countercheck: "No contract or trap is documented.",
  recommendation: "Delete the comment.",
});

test("evidence references and prose line lists count as locations only for evidence recall", () => {
  const report = [
    anchor("a.ts", 10),
    anchor("a.ts", 83),
    anchor("a.ts", 201),
    anchor("b.ts", 5, 6),
    anchor("a.ts", 400),
  ];
  const result = score({ report, preserve: [] }, [
    finding(
      300,
      300,
      "The same narration appears on lines 10, 82–85 and 201; see `b.ts:5-6` and a.ts:old:400.",
    ),
  ]);
  assert.deepEqual(result.hits, [
    "a.ts:10-10",
    "a.ts:83-83",
    "a.ts:201-201",
    "b.ts:5-6",
  ]);
  assert.equal(result.recall, 4 / 5);
  assert.equal(result.recallPrimary, 0);
});

test("a location spanning more than 30 lines hits nothing", () => {
  const report = [anchor("a.ts", 30)];
  assert.equal(score({ report, preserve: [] }, [finding(1, 31)]).recall, 0);
  assert.equal(score({ report, preserve: [] }, [finding(1, 30)]).recall, 1);
  assert.equal(
    score({ report, preserve: [] }, [finding(1, 2, "See lines 1 to 40.")])
      .recall,
    0,
  );
});

test("flagging a kept comment lowers retention and unlabelled metrics stay null", () => {
  const preserve = [anchor("a.ts", 3), anchor("a.ts", 50)];
  const result = score({ report: [], preserve }, [finding(3, 3)]);
  assert.deepEqual(result.preserveHits, ["a.ts:3-3"]);
  assert.equal(result.retention, 0.5);
  assert.equal(result.recall, null);
  assert.equal(score({ report: [], preserve: [] }, []).retention, null);
});
