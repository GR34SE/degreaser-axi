import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewInput } from "../types.ts";
import { packShards, uncovered, verifyBatches } from "./coverage.ts";
import type { Finding } from "./types.ts";

test("shards pack greedily in input order and an oversize path stands alone", () => {
  const sizes = new Map([
    ["a", 10],
    ["b", 25],
    ["big", 90],
    ["c", 5],
    ["d", 30],
  ]);
  assert.deepEqual(packShards(["a", "b", "big", "c", "d", "gone"], sizes, 40), [
    ["a", "b"],
    ["big"],
    ["c", "d"],
    ["gone"],
  ]);
  assert.deepEqual(packShards([], sizes, 40), []);
});

test("verification batches fill across paths in path and line order, at most the batch size", () => {
  const at = (path: string, line: number): Finding => ({
    location: { path, side: "new", startLine: line, endLine: line },
    quote: "x",
    title: "t",
    verdict: "unverified",
  });
  const b5 = at("b", 5);
  const a10 = at("a", 10);
  const c1 = at("c", 1);
  const a2 = at("a", 2);
  const b2 = at("b", 2);
  const findings = [b5, a10, c1, a2, b2];
  assert.deepEqual(verifyBatches(findings, 3), [
    [a2, a10, b2],
    [b5, c1],
  ]);
  assert.ok(verifyBatches(findings, 3)[0]?.[0] === a2);
  assert.deepEqual(findings, [b5, a10, c1, a2, b2]);
  assert.deepEqual(verifyBatches([], 3), []);
});

test("a new file at a rename's old name does not cover the renamed path", () => {
  const record = (path: string, oldPath: string | null) => ({
    path,
    oldPath,
    binary: false,
    oldMode: oldPath ? "100644" : null,
    newMode: "100644",
  });
  const input = {
    paths: [record("moved.ts", "kept.ts"), record("kept.ts", null)],
  } as unknown as ReviewInput;
  assert.deepEqual(uncovered(input, ["kept.ts"]), ["moved.ts"]);
});
