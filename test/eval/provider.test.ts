import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scoreSample } from "../../eval/assert/anchor-match.mjs";
import { setup } from "../utils/public-review-fixture.ts";

const productDir = fileURLToPath(new URL("../../", import.meta.url));
const providerUrl = new URL("../../eval/provider.mjs", import.meta.url).href;

async function fixture(t: TestContext, plan: object = {}, timeoutMs = 20_000) {
  const f = setup(t);
  f.write("module.ts", "export const answer = 42;\n");
  f.git("add", "module.ts");
  f.git("commit", "--no-gpg-sign", "-m", "Source snapshot");
  const events = join(f.root, "ignored", "provider-processes.jsonl");
  f.write("ignored/provider-processes.jsonl", "");
  const planPath = join(f.root, "ignored", "provider-plan.json");
  writeFileSync(
    planPath,
    JSON.stringify({
      log: join(f.root, "ignored", "prompts.jsonl"),
      lifecycleLog: join(f.root, "ignored", "lifecycle.jsonl"),
      ...plan,
    }),
  );
  const loaderPath = join(f.root, "ignored", "provider-loader.mjs");
  const loader = new URL("../utils/synthetic-runtime.mjs", import.meta.url)
    .href;
  writeFileSync(
    loaderPath,
    `
    import {appendFileSync, existsSync} from "node:fs";
    import {spawnSync} from "node:child_process";
    appendFileSync(${JSON.stringify(events)}, JSON.stringify({
      cwd: process.cwd(), pid: process.pid, leaked: process.env.EVAL_PRIVATE_CANARY,
      evalVisible: existsSync("eval"), planVisible: existsSync("ignored"),
      history: spawnSync("git", ["log", "--all", "--format=%B"], {encoding:"utf8"}).stdout
    }) + "\\n");
    await import(${JSON.stringify(loader)});
  `,
  );
  const { default: Provider } = await import(providerUrl);
  const provider = new Provider({
    config: {
      productDir,
      agent: "claude",
      model: "claude-haiku-4-5-20251001",
      timeoutMs,
      env: {
        NODE_OPTIONS: `--import=${pathToFileURL(loaderPath).href}`,
        SYNTHETIC_PLAN: planPath,
      },
    },
  });
  const sample = {
    id: "synthetic/source",
    aspects: ["low-value-comments"],
    repo: { directory: f.root },
    review: {
      scope: "repository",
      paths: ["module.ts"],
      task: "Audit this source.",
    },
    target: {
      report: [{ id: "PRIVATE_LABEL_CANARY" }],
      preserve: [],
      forbidden: [],
    },
  };
  const invoke = () =>
    provider.callApi("PRIVATE_PROMPT_CANARY", { vars: { sample } });
  const logs = (name: string) => {
    const path = join(f.root, "ignored", name);
    return existsSync(path)
      ? readFileSync(path, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((s) => JSON.parse(s))
      : [];
  };
  const cleaned = () => {
    const processes = logs("provider-processes.jsonl");
    assert.ok(processes.length > 0);
    const dirs = new Set<string>(processes.map((p) => p.cwd));
    for (const dir of dirs) {
      assert.notEqual(dir, f.root);
      assert.ok(!dir.startsWith(productDir));
      assert.equal(existsSync(dir), false, `temporary source remains: ${dir}`);
    }
    for (const p of processes) {
      assert.equal(p.leaked, undefined);
      assert.equal(p.evalVisible, false);
      assert.equal(p.planVisible, false);
      assert.ok(!p.history.includes("Private evaluation data"));
    }
  };
  return { ...f, provider, sample, invoke, logs, cleaned };
}

test("provider uses the public CLI on isolated source and exports completed evidence", async (t) => {
  const f = await fixture(t);
  f.write("eval/labels.json", "PRIVATE_LABEL_CANARY");
  f.git("add", "eval/labels.json");
  f.git("commit", "--no-gpg-sign", "-m", "Private evaluation data");
  process.env.EVAL_PRIVATE_CANARY = "must-not-inherit";
  t.after(() => {
    delete process.env.EVAL_PRIVATE_CANARY;
  });
  const before = f.git("status", "--porcelain");
  const result = await f.invoke();
  assert.equal(result.error, undefined, result.error);
  const envelope = JSON.parse(result.output);
  assert.equal(envelope.sampleId, f.sample.id);
  assert.equal(envelope.export.status, "completed");
  assert.deepEqual(envelope.export.findings, []);
  assert.equal(envelope.export.coverage[0].examined, "1/1");
  assert.equal(envelope.meta.agent, "claude");
  assert.equal(envelope.meta.model, "claude-haiku-4-5-20251001");
  assert.match(envelope.meta.productSha, /^[a-f0-9]{40}$/);
  assert.match(envelope.meta.productHash, /^[a-f0-9]{64}$/);
  assert.match(envelope.meta.sampleHash, /^[a-f0-9]{64}$/);
  assert.equal(envelope.meta.sessionCount, 1);
  assert.ok(envelope.meta.durationMs > 0);
  const prompts = f.logs("prompts.jsonl");
  assert.equal(prompts.length, 1);
  assert.ok(!JSON.stringify(prompts).includes("PRIVATE_LABEL_CANARY"));
  assert.ok(!JSON.stringify(prompts).includes("PRIVATE_PROMPT_CANARY"));
  assert.equal(f.git("status", "--porcelain"), before);
  f.cleaned();
});

test("provider preserves partial status rather than treating export exit zero as a pass", async (t) => {
  const f = await fixture(t, {
    worker: {
      result: {
        aspect: "low-value-comments",
        status: "incomplete",
        findings: [],
        limitations: ["Synthetic uncertainty."],
        unresolved: [
          { scope: "context", reason: "Synthetic unfinished assessment." },
        ],
      },
    },
  });
  const result = await f.invoke();
  assert.equal(result.error, undefined, result.error);
  const envelope = JSON.parse(result.output);
  assert.equal(envelope.export.status, "partial");
  assert.equal(envelope.meta.outcome, "worker-quality-partial");
  f.cleaned();
});

test("only unresolved worker-quality failures make a partial review rubric evidence", async (t) => {
  const peers = ["masked-errors", "low-value-comments"];
  for (const [name, worker, expected] of [
    [
      "rate limit",
      { error: { message: "Quota exhausted" } },
      /rate-limited failure \(recovery: wait-for-quota\)/,
    ],
    [
      "authentication",
      { error: { message: "Denied", data: { authRequired: true } } },
      /authentication failure \(recovery: fix-authentication\)/,
    ],
    [
      "network timeout without evidence",
      { error: { message: "Request timed out" } },
      /timeout failure \(recovery: resume\)/,
    ],
    ["invalid output", { result: "not a result" }, "partial"],
    [
      "recovered retry",
      { attempts: [{ result: "not a result" }, {}] },
      "completed",
    ],
  ] as const) {
    await t.test(name, async (t) => {
      const f = await fixture(t, { workers: { "low-value-comments": worker } });
      const sample = { ...f.sample, aspects: peers };
      const result = await f.provider.callApi("", { vars: { sample } });
      if (expected instanceof RegExp) {
        assert.match(result.error, expected);
        assert.equal(result.output, undefined);
      } else {
        assert.equal(result.error, undefined, result.error);
        const envelope = JSON.parse(result.output);
        assert.equal(envelope.export.status, expected);
        const score = scoreSample(
          {
            ...sample,
            family: "synthetic",
            target: {
              report: [{ id: "R1", path: "module.ts", lines: [1, 1] }],
              preserve: [],
              forbidden: [],
            },
          },
          envelope,
        );
        assert.equal(score.complete, expected === "completed");
        if (expected === "partial") {
          assert.equal(envelope.meta.outcome, "worker-quality-partial");
          assert.equal(score.reason, "incomplete-review");
        } else assert.equal(envelope.meta.outcome, undefined);
      }
      f.cleaned();
    });
  }
});

test("invalid worker output and metadata failure produce errors, never clean output", async (t) => {
  for (const [plan, error] of [
    [{ worker: { result: "not a result" } }, /Review ended failed/],
    [{ metadataFailure: true }, /invalid review outcome/],
  ] as const) {
    await t.test(JSON.stringify(plan), async (t) => {
      const f = await fixture(t, plan);
      const result = await f.invoke();
      assert.match(result.error, error);
      assert.equal(result.output, undefined);
      f.cleaned();
    });
  }
});

test("provider reattaches with wait when the public review is still running", async (t) => {
  const f = await fixture(t, { delayMs: 1600 });
  const result = await f.invoke();
  assert.equal(result.error, undefined, result.error);
  const envelope = JSON.parse(result.output);
  assert.equal(envelope.export.status, "completed");
  assert.ok(envelope.meta.waitCount >= 1);
  f.cleaned();
});

test("provider exports quote-validated source findings without clipping their evidence", async (t) => {
  const f = await fixture(t, {
    worker: {
      result: {
        aspect: "low-value-comments",
        status: "findings",
        limitations: [],
        findings: [
          {
            location: {
              path: "module.ts",
              side: "new",
              startLine: 1,
              endLine: 1,
            },
            quote: "export const answer = 42;",
            title: "Synthetic source finding",
            evidence: "Source at module.ts:1.",
            consequence: "Synthetic maintenance cost.",
            countercheck: "The synthetic caller does not require it.",
            recommendation: "Review the unnecessary constant.",
          },
        ],
      },
    },
  });
  const result = await f.invoke();
  assert.equal(result.error, undefined, result.error);
  const [finding] = JSON.parse(result.output).export.findings;
  assert.equal(finding.id, "F1");
  assert.equal(finding.path, "module.ts");
  assert.equal(finding.quote, "export const answer = 42;");
  assert.equal(finding.recommendation, "Review the unnecessary constant.");
  f.cleaned();
});

test("provider runs explicit worktree and branch scopes against final source", async (t) => {
  for (const scope of ["worktree", "branch"]) {
    await t.test(scope, async (t) => {
      const f = await fixture(t);
      f.git("branch", "given-base");
      f.write("module.ts", "export const updated = 43;\n");
      f.git("add", "module.ts");
      if (scope === "branch")
        f.git("commit", "--no-gpg-sign", "-m", "Branch update");
      const sample = {
        ...f.sample,
        review: { ...f.sample.review, scope, base: "given-base" },
      };
      const result = await f.provider.callApi("", { vars: { sample } });
      assert.equal(result.error, undefined, result.error);
      const envelope = JSON.parse(result.output);
      assert.equal(envelope.export.status, "completed");
      assert.equal(envelope.export.scope, scope);
      assert.equal(envelope.export.coverage[0].examined, "1/1");
      f.cleaned();
    });
  }
});

test("provider timeout cancels and joins the owned worker and descendant before deletion", async (t) => {
  const f = await fixture(
    t,
    { worker: { hang: true, descendant: true } },
    5000,
  );
  const started = Date.now();
  const result = await f.invoke();
  assert.match(result.error, /timeout/i);
  assert.equal(result.output, undefined);
  assert.ok(Date.now() - started < 40_000);
  const life = f.logs("lifecycle.jsonl");
  assert.ok(life.some((event) => event.type === "prompt"));
  assert.ok(life.some((event) => event.type === "descendant"));
  const pids = new Set<number>(
    life.flatMap((event) => [event.pid, event.childPid].filter(Boolean)),
  );
  for (const pid of pids) {
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  }
  f.cleaned();
});

test("provider timeout during model discovery does not leave an unowned adapter", async (t) => {
  const f = await fixture(t, { metadataHang: true }, 1500);
  const result = await f.invoke();
  const processes = f.logs("lifecycle.jsonl");
  const pids = new Set<number>(processes.map((event) => event.pid));
  assert.match(result.error, /timeout/i);
  assert.equal(result.output, undefined);
  assert.ok(processes.some((event) => event.type === "session"));
  for (const pid of pids)
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  f.cleaned();
});

test("provider does not erase the worker marker to bypass recursive-review restrictions", async (t) => {
  const f = await fixture(t);
  const previous = process.env.DEGREASER_WORKER;
  process.env.DEGREASER_WORKER = "1";
  try {
    const result = await f.invoke();
    assert.match(result.error, /worker-marked/);
    assert.equal(result.output, undefined);
    assert.deepEqual(f.logs("provider-processes.jsonl"), []);
  } finally {
    if (previous === undefined) delete process.env.DEGREASER_WORKER;
    else process.env.DEGREASER_WORKER = previous;
  }
});
