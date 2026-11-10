import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runEvaluation } from "../../eval/runner.mjs";
import { setup } from "../utils/public-review-fixture.ts";

test("the runner reviews a real checkout through the public CLI and records a complete missed review", async (t) => {
  const f = setup(t);
  f.write("module.ts", "// Obvious narration\nexport const answer = 42;\n");
  f.git("add", "module.ts");
  f.git("commit", "--no-gpg-sign", "-m", "Synthetic source snapshot");
  f.write(
    "ignored/plan.json",
    JSON.stringify({ log: join(f.root, "ignored/events.jsonl") }),
  );
  const output = join(f.root, "ignored/result");
  const sample = {
    id: "native-offline",
    family: "synthetic",
    split: "dev",
    labelKind: "synthetic",
    aspects: ["low-value-comments"],
    repo: { directory: f.root },
    review: {
      scope: "repository",
      paths: ["module.ts"],
      task: "Audit comments.",
    },
    provenance: { source: "synthetic", revision: "independent-fixture" },
    target: {
      report: [{ id: "R1", path: "module.ts", lines: [1, 1] }],
      preserve: [],
      forbidden: [],
    },
  };
  const result = await runEvaluation({
    samples: [sample],
    outputDir: output,
    repeat: 1,
    budget: 2,
    model: "claude-haiku-4-5-20251001",
    allowModels: true,
    timeoutMs: 20_000,
    env: {
      NODE_OPTIONS: `--import=${new URL("../utils/synthetic-runtime.mjs", import.meta.url).href}`,
      SYNTHETIC_PLAN: join(f.root, "ignored/plan.json"),
    },
    productDir: fileURLToPath(new URL("../../", import.meta.url)),
  });
  const row = JSON.parse(readFileSync(join(output, "records.jsonl"), "utf8"));
  assert.equal(result.providerErrors, 0, row.error);
  assert.equal(result.incompleteRecords, 0);
  assert.equal(row.metrics.recall, 0);
  assert.deepEqual(row.metrics.misses, ["R1"]);
  assert.equal(row.envelope.meta.sessionCount, 1);
});
