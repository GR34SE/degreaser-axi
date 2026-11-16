import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { decode } from "@toon-format/toon";
import { queueFixture } from "../utils/queue-fixture.ts";

test("review warns about configured limits below defaults and sync proposes removing them without changing choices", (t) => {
  const f = queueFixture(t, {
    concurrency: 16,
    limits: {
      workerTimeoutSeconds: 300,
      workerIdleSeconds: 60,
      maxTurns: 10,
      runTimeoutSeconds: 900,
    },
  });
  const started = f.start();
  assert.equal(f.finish().status, 0);
  for (const [field, value, installed] of [
    ["concurrency", 16, 36],
    ["limits.workerTimeoutSeconds", 300, 900],
    ["limits.workerIdleSeconds", 60, 180],
    ["limits.maxTurns", 10, 40],
    ["limits.runTimeoutSeconds", 900, 1800],
  ])
    assert.ok(
      started.stderr.includes(
        `${field}=${value} is below the default ${installed}`,
      ),
      started.stderr,
    );
  const synced = f.run(["config", "sync"]);
  assert.equal(synced.status, 0, synced.stdout);
  const result = decode(synced.stdout) as {
    suggestedRemovals: { field: string }[];
  };
  assert.deepEqual(result.suggestedRemovals.map((item) => item.field).sort(), [
    "concurrency",
    "limits.maxTurns",
    "limits.runTimeoutSeconds",
    "limits.workerIdleSeconds",
    "limits.workerTimeoutSeconds",
  ]);
  const rc = JSON.parse(
    readFileSync(join(f.root, ".degreaserrc.json"), "utf8"),
  );
  assert.equal(rc.concurrency, 16);
  assert.equal(rc.limits.workerTimeoutSeconds, 300);
});
