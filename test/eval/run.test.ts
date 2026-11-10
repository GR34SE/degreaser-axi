import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { fixture } from "../utils/git-fixture.ts";
import {
  deriveDataset,
  readJsonLines,
  type Sample,
} from "./support/dataset.ts";
import type { ReviewRecord } from "./support/review.ts";

const entry = fileURLToPath(new URL("./run.ts", import.meta.url));
const loader = new URL("../utils/synthetic-runtime.mjs", import.meta.url).href;
const FIXTURES = "test/live/support/comment-fixtures.ts";

function dataset(t: TestContext) {
  const f = fixture(t);
  const commit = (files: Record<string, string>) => {
    for (const [path, content] of Object.entries(files)) f.write(path, content);
    f.git("add", "--all");
    f.git("commit", "--no-gpg-sign", "-m", "Change");
    return f.git("rev-parse", "HEAD").trim();
  };
  const before = commit({
    "src/a/edit.ts":
      "// Gets the value.\nexport const a = 1;\n// Invariant: retries keep caller identity.\nexport const b = 2;\n// Shortened note,\n// second line.\nexport const c = 3;\n",
    "src/b/kept.ts": "// Boundary: input is untrusted.\nexport const d = 4;\n",
    [FIXTURES]: "// Obvious fixture comment.\nexport const f = 1;\n",
  });
  const after = commit({
    "src/a/edit.ts":
      "export const a = 1;\n// Invariant: retries keep caller identity.\nexport const b = 2;\n// Shortened note,\nexport const c = 3;\n",
    [FIXTURES]: "export const f = 1;\n",
  });
  const output = join(
    mkdtempSync(join(tmpdir(), "degreaser-eval-test-")),
    "dataset",
  );
  t.after(() => rmSync(join(output, ".."), { recursive: true, force: true }));
  return { output, samples: deriveDataset(output, f.root, before, after) };
}

test("derive labels deleted comments REPORT, untouched ones PRESERVE and partly edited ones neither", (t) => {
  const { output, samples } = dataset(t);
  const view = samples.map(({ id, split, paths, report, preserve }) => ({
    id,
    split,
    paths,
    report: report.map((anchor) => anchor.id),
    preserve: preserve.map((anchor) => anchor.id),
  }));
  assert.deepEqual(view, [
    {
      id: "self/src/a/edit.ts",
      split: "regression",
      paths: ["src/a/edit.ts"],
      report: ["src/a/edit.ts:1-1"],
      preserve: ["src/a/edit.ts:keep:3-3"],
    },
    {
      id: "self/src/b/kept.ts",
      split: "dev",
      paths: ["src/b/kept.ts"],
      report: [],
      preserve: ["src/b/kept.ts:keep:1-1"],
    },
    {
      id: "self/whole-repository",
      split: "regression",
      paths: [],
      report: ["src/a/edit.ts:1-1"],
      preserve: ["src/a/edit.ts:keep:3-3", "src/b/kept.ts:keep:1-1"],
    },
  ]);
  assert.deepEqual(
    readJsonLines<Sample>(join(output, "samples.jsonl")),
    samples,
  );
  const git = (...args: string[]) =>
    spawnSync("git", args, { cwd: join(output, "repo"), encoding: "utf8" })
      .stdout;
  assert.equal(git("rev-list", "--count", "--all").trim(), "1");
  assert.equal(git("status", "--porcelain"), "");
  assert.match(
    readFileSync(join(output, "repo/src/a/edit.ts"), "utf8"),
    /Gets the value/,
  );
});

test("run plans without launching, scores a completed review and never scores a partial or failed one", (t) => {
  const { output, samples } = dataset(t);
  const edit = samples.filter((sample) => sample.id === "self/src/a/edit.ts");
  writeFileSync(
    join(output, "samples.jsonl"),
    edit.map((sample) => `${JSON.stringify(sample)}\n`).join(""),
  );
  const plan = join(output, "..", "plan.json");
  const evaluate = (name: string, worker: object, allow = true) => {
    writeFileSync(
      plan,
      JSON.stringify({ log: join(output, "..", "prompts.jsonl"), worker }),
    );
    const destination = join(output, "..", name);
    const result = spawnSync(
      process.execPath,
      [
        entry,
        "run",
        "--samples",
        join(output, "samples.jsonl"),
        "--split",
        "all",
        "--repeat",
        "2",
        "--concurrency",
        "2",
        "--output",
        destination,
        ...(allow ? ["--allow-models"] : []),
      ],
      {
        encoding: "utf8",
        timeout: 120_000,
        env: {
          ...process.env,
          NODE_OPTIONS: `--import=${loader}`,
          SYNTHETIC_PLAN: plan,
        },
      },
    );
    const file = join(destination, "records.jsonl");
    return {
      ...result,
      records: existsSync(file) ? readJsonLines<ReviewRecord>(file) : [],
      summary: existsSync(join(destination, "summary.json"))
        ? JSON.parse(readFileSync(join(destination, "summary.json"), "utf8"))
        : undefined,
      destination,
    };
  };
  const finding = {
    location: { path: "src/a/edit.ts", side: "new", startLine: 1, endLine: 1 },
    quote: "// Gets the value.",
    title: "Narrating comment",
    evidence: "The comment restates the declaration below it.",
    consequence: "Readers learn nothing beyond the code.",
    countercheck: "No contract or trap is documented.",
    recommendation: "Delete the comment.",
  };
  const result = (status: string, findings: object[], extra = {}) => ({
    result: {
      aspect: "low-value-comments",
      status,
      findings,
      limitations: [],
      ...extra,
    },
  });

  const planned = evaluate("planned", {}, false);
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(
    planned.stdout,
    /1 samples x 2 repeats = 2 reviews, at most 4 worker sessions/,
  );
  assert.equal(existsSync(planned.destination), false);
  assert.equal(existsSync(join(output, "..", "prompts.jsonl")), false);

  const found = evaluate("found", result("findings", [finding]));
  assert.equal(found.status, 0, JSON.stringify(found.records));
  assert.deepEqual(
    found.records.map((r) => (r.outcome === "complete" ? r.hits : r.outcome)),
    [["src/a/edit.ts:1-1"], ["src/a/edit.ts:1-1"]],
  );
  assert.equal(found.summary.groups[0].recall, 1);
  assert.equal(found.summary.groups[0].retention, 1);
  assert.ok(existsSync(join(found.destination, "summary.md")));

  const partial = evaluate(
    "partial",
    result("incomplete", [], {
      limitations: ["Synthetic uncertainty."],
      unresolved: [
        { scope: "context", reason: "Synthetic unfinished assessment." },
      ],
    }),
  );
  assert.equal(partial.status, 1);
  assert.deepEqual(
    partial.records.map((record) => record.outcome),
    ["incomplete", "incomplete"],
  );
  assert.equal(partial.summary.groups[0].recall, null);
  assert.equal(partial.summary.groups[0].completeness, 0);

  const denied = evaluate("denied", {
    error: { message: "Denied", data: { authRequired: true } },
  });
  assert.equal(denied.status, 1);
  assert.match(
    JSON.stringify(denied.records),
    /"outcome":"error","error":"Review ended failed after a low-value-comments authentication failure/,
  );
  assert.equal(denied.summary.errors, 2);
});
