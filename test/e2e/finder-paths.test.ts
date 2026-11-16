import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decode } from "@toon-format/toon";
import { capture, queueFixture, until } from "../utils/queue-fixture.ts";

test("a 5000-file audit sends at most forty work paths and a full-scope reference in a bounded prompt", async (t) => {
  const f = queueFixture(t, {
    limits: { workerTimeoutSeconds: 60, runTimeoutSeconds: 90 },
  });
  for (let i = 0; i < 4998; i++)
    f.write(
      `files/${String(i).padStart(4, "0")}.ts`,
      `export const value${i} = ${i};\n`,
    );
  f.setPlan({ worker: { resultGate: f.gate("never") } });
  const response = capture(
    f.launch([
      "review",
      "--scope",
      "repository",
      "--task",
      "Audit the source",
      "--aspects",
      "low-value-comments",
    ]),
  );
  await until(
    () => f.events().length === 1,
    "The real coordinator sends the first finder prompt",
    20000,
  );
  try {
    const prompt = f.events()[0]?.prompt ?? "";
    assert.ok(
      Buffer.byteLength(prompt) < 64 * 1024,
      "The short-task 5000-file fixture must fit in a 64 KiB prompt",
    );
    const match = /<(degreaser-input-[0-9a-f]{16})>\n([\s\S]*?)\n<\/\1>/.exec(
      prompt,
    );
    assert.ok(match?.[2]);
    const input = decode(match[2]) as {
      paths: { path: string }[];
      remainingPaths: number;
      assessedPaths: { file: string; property: string; count: number };
    };
    assert.equal(input.assessedPaths.count, 5000);
    assert.equal(input.assessedPaths.property, "paths");
    assert.equal(input.paths.length, 40);
    assert.equal(input.remainingPaths, 4960);
    const full = JSON.parse(readFileSync(input.assessedPaths.file, "utf8"));
    assert.equal(full.paths.length, 5000);
    assert.deepEqual(
      input.paths.map((path) => path.path),
      full.paths.slice(0, 40).map((path: { path: string }) => path.path),
    );
  } finally {
    assert.equal(f.run(["cancel", f.state().id]).status, 1);
    await response;
  }
});
