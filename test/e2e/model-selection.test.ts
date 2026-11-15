import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { decode } from "@toon-format/toon";
import {
  acceptAgent,
  acceptModel,
  acceptVerifierAgent,
  acceptVerifierModel,
  install,
  integrations,
  project,
  setup,
  skill,
} from "../utils/init-fixture.ts";
import { queueFixture } from "../utils/queue-fixture.ts";

test("Claude latest aliases precede pins, are recommended and persist without a version", (t) => {
  const f = setup(t);
  f.setPlan({
    models: {
      claude: [
        "claude-sonnet-4-5-20250929",
        "claude-haiku-4-5-20251001",
        "sonnet",
        "haiku",
        "opus",
      ],
    },
  });
  const preview = f.run(["--agent", "claude"]);
  assert.equal(preview.status, 2, preview.stdout);
  const output = decode(preview.stdout) as {
    candidates: { model: string; label: string }[];
    recommendation: { agent: string; model: string };
    verifierPrefill: { agent: string; model: string };
  };
  assert.deepEqual(
    output.candidates.map((c) => c.model),
    [
      "sonnet",
      "haiku",
      "opus",
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-5-20251001",
    ],
  );
  assert.equal(output.candidates[0]?.label, "sonnet (latest)");
  assert.equal(output.recommendation.agent, "claude");
  assert.equal(output.recommendation.model, "sonnet");
  assert.deepEqual(output.verifierPrefill, { agent: "claude", model: "opus" });
  const selected = f.run(
    ["--agent", "claude", "--harnesses", "claude"],
    [
      ["Which agents do you want to install to?", "\r"],
      ["Installation scope", "\r"],
      [acceptModel[0], "sonnet\r"],
      acceptVerifierAgent,
      acceptVerifierModel,
      install,
    ],
  );
  assert.equal(selected.status, 0, selected.stdout);
  assert.match(selected.stdout, /sonnet \(latest\)/);
  assert.equal(f.config().model, "sonnet");
  assert.deepEqual(f.config().verifier, { model: "opus" });
});

test("terminal and non-TTY init recommend the same agent when several offer the preferred tier", (t) => {
  const f = setup(t);
  f.setPlan({ models: { claude: ["sonnet", "opus"] } });
  const preview = f.run([]);
  assert.equal(preview.status, 2, preview.stdout);
  const output = decode(preview.stdout) as {
    recommendation: { agent: string; model: string };
    verifierPrefill: { agent: string; model: string };
  };
  assert.deepEqual(
    [output.recommendation.agent, output.recommendation.model],
    ["claude", "sonnet"],
  );
  assert.deepEqual(output.verifierPrefill, { agent: "claude", model: "opus" });
  const terminal = f.run(
    [],
    [
      integrations,
      project,
      skill,
      acceptAgent,
      acceptModel,
      acceptVerifierAgent,
      acceptVerifierModel,
      install,
    ],
  );
  assert.equal(terminal.status, 0, terminal.stdout);
  assert.equal(f.config().agent, "claude");
  assert.equal(f.config().model, "sonnet");
  assert.deepEqual(f.config().verifier, { model: "opus" });
});

test("Codex latest family choices precede pins and init saves the rolling choice", (t) => {
  const f = setup(t);
  f.setPlan({
    models: {
      codex: ["gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol", "gpt-5.6-luna"],
    },
  });
  const preview = f.run(["--agent", "codex"]);
  assert.equal(preview.status, 2, preview.stdout);
  const output = decode(preview.stdout) as {
    candidates: { model: string; label: string }[];
    recommendation: { model: string };
    verifierPrefill: { model: string };
  };
  assert.deepEqual(
    output.candidates.map((c) => [c.model, c.label]),
    [
      ["latest:luna", "luna (latest)"],
      ["latest:terra", "terra (latest)"],
      ["latest:sol", "sol (latest)"],
      ["gpt-6-luna", "gpt-6-luna"],
      ["gpt-6.1-terra", "gpt-6.1-terra"],
      ["gpt-6.1-sol", "gpt-6.1-sol"],
      ["gpt-5.6-luna", "gpt-5.6-luna"],
    ],
  );
  assert.equal(output.recommendation.model, "latest:terra");
  assert.equal(output.verifierPrefill.model, "latest:sol");
  const selected = f.run([
    "--agent",
    "codex",
    "--model",
    "latest:terra",
    "--verifier-model",
    "latest:sol",
    "--harnesses",
    "codex",
  ]);
  assert.equal(selected.status, 0, selected.stdout);
  assert.equal(f.config().model, "latest:terra");
  assert.deepEqual(f.config().verifier, { model: "latest:sol" });
});

test("Codex latest choices keep variant families separate and recommend an unpinned Mini", (t) => {
  const f = setup(t);
  f.setPlan({
    models: {
      codex: [
        "gpt-5.10-mini",
        "gpt-5.9-mini",
        "gpt-6-codex-mini",
        "gpt-6-codex",
        "gpt-6",
      ],
    },
  });
  const preview = f.run(["--agent", "codex"]);
  assert.equal(preview.status, 2, preview.stdout);
  const output = decode(preview.stdout) as {
    candidates: { model: string }[];
    recommendation: { model: string };
  };
  assert.deepEqual(
    output.candidates.slice(0, 4).map((c) => c.model),
    ["latest:mini", "latest:codex-mini", "latest:codex", "latest:gpt"],
  );
  assert.equal(output.recommendation.model, "latest:mini");
});

for (const [models, worker, verifier] of [
  [
    ["gpt-6-luna", "gpt-6-astra", "gpt-6-terra", "gpt-6-sol"],
    "latest:terra",
    "latest:sol",
  ],
  [["gpt-6-luna", "gpt-6-sol"], "latest:luna", "latest:sol"],
  [["gpt-6-luna", "gpt-6-terra"], "latest:terra", "latest:terra"],
  [["gpt-6-astra", "gpt-6-luna"], "latest:luna", "latest:astra"],
  [["gpt-6-mini"], "latest:mini", "latest:mini"],
] as const)
  test(`init recommends worker ${worker} and verifier ${verifier} from ${models.join(", ")}`, (t) => {
    const f = setup(t);
    f.setPlan({ models: { codex: [...models] } });
    const preview = f.run(["--agent", "codex"]);
    assert.equal(preview.status, 2, preview.stdout);
    const output = decode(preview.stdout) as {
      recommendation: { model: string };
      verifierPrefill: { model: string };
    };
    assert.equal(output.recommendation.model, worker);
    assert.equal(output.verifierPrefill.model, verifier);
  });

test("Codex latest upgrades on new reviews, pins resume and preserves explicit pins", (t) => {
  const f = queueFixture(t, {
    model: "latest:luna",
    verifier: { model: "latest:sol" },
  });
  const review = () =>
    f.run([
      "review",
      "--scope",
      "worktree",
      "--task",
      "Update source",
      "--wait",
      "20",
      "--aspects",
      "low-value-comments",
    ]);
  const rc = readFileSync(join(f.root, ".degreaserrc.json"));
  f.setPlan({
    models: { codex: ["gpt-6.9-luna", "gpt-6.10-luna", "gpt-7-sol"] },
    results: {
      "low-value-comments": {
        aspect: "low-value-comments",
        status: "incomplete",
        findings: [],
        limitations: ["One construct remains."],
      },
    },
  });
  const started = review();
  assert.equal(started.status, 1, started.stdout);
  const first = f.state();
  assert.equal(first.tasks[0]?.assignment.model, "gpt-6.10-luna");
  assert.ok(
    started.stderr.includes("identities: codex/gpt-6.10-luna;"),
    started.stderr,
  );
  f.setPlan({
    models: { codex: ["gpt-7-luna", "gpt-6.10-luna", "gpt-7-sol"] },
  });
  const resumed = f.run(["resume", first.id, "--wait", "20"]);
  assert.equal(resumed.status, 0, resumed.stdout);
  assert.ok(
    resumed.stderr.includes("identities: codex/gpt-6.10-luna;"),
    resumed.stderr,
  );
  assert.equal(f.state().tasks[0]?.assignment.model, "gpt-6.10-luna");
  const runBeforeChange = readFileSync(
    join(f.root, ".degreaser/runs", first.id, "run.json"),
  );
  f.write(
    ".degreaserrc.json",
    rc.toString().replace("latest:luna", "latest:sol"),
  );
  const changed = f.run(["resume", first.id, "--wait", "20"]);
  assert.equal(changed.status, 2, changed.stdout);
  assert.match(changed.stdout, /input-changed/);
  assert.deepEqual(
    readFileSync(join(f.root, ".degreaser/runs", first.id, "run.json")),
    runBeforeChange,
  );
  f.write(".degreaserrc.json", rc);
  assert.deepEqual(
    f.events().map((e) => e.model),
    ["gpt-6.10-luna", "gpt-6.10-luna"],
  );
  const upgraded = review();
  assert.equal(upgraded.status, 0, upgraded.stdout);
  assert.equal(f.state().tasks[0]?.assignment.model, "gpt-7-luna");
  assert.deepEqual(readFileSync(join(f.root, ".degreaserrc.json")), rc);
  f.write(
    ".degreaserrc.json",
    JSON.stringify({
      agent: "codex",
      model: "gpt-6.10-luna",
      verifier: { model: "gpt-7-sol" },
    }),
  );
  const pinned = review();
  assert.equal(pinned.status, 0, pinned.stdout);
  assert.equal(f.state().tasks[0]?.assignment.model, "gpt-6.10-luna");
});

test("Codex latest overrides stay in their families and missing families refuse without fallback", (t) => {
  const f = queueFixture(t, {
    model: "latest:luna",
    aspects: { "low-value-comments": { model: "latest:sol" } },
  });
  f.setPlan({
    models: { codex: ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-sol"] },
  });
  const result = f.run([
    "review",
    "--scope",
    "worktree",
    "--task",
    "Update source",
    "--wait",
    "20",
    "--aspects",
    "masked-errors,low-value-comments",
  ]);
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(
    f
      .events()
      .map((e) => e.model)
      .sort(),
    ["gpt-6-luna", "gpt-6.1-sol"].sort(),
  );
  const empty = queueFixture(t, { model: "latest:luna" });
  empty.setPlan({ models: { codex: ["gpt-7-sol", "custom-luna"] } });
  const refused = empty.start(["--aspects", "low-value-comments"]);
  assert.equal(refused.status, 2, refused.stdout);
  assert.match(refused.stdout, /invalid-input/);
  assert.match(
    refused.stdout,
    /codex\/latest:luna is neither an advertised codex model ID nor a latest selector with an advertised family\. No substitute was selected\. Available codex models: latest:sol, gpt-7-sol, custom-luna\./,
  );
  assert.ok(!existsSync(join(empty.root, ".degreaser/state.json")));
  assert.deepEqual(empty.events(), []);
});

test("Claude native latest selection reaches the worker without replacing it with a pin", (t) => {
  const f = queueFixture(t, {
    agent: "claude",
    model: "sonnet",
    verifier: { model: "sonnet" },
  });
  f.setPlan({
    models: { claude: ["claude-sonnet-4-5-20250929", "sonnet"] },
  });
  const result = f.run([
    "review",
    "--scope",
    "worktree",
    "--task",
    "Update source",
    "--wait",
    "20",
    "--aspects",
    "low-value-comments",
  ]);
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(
    f.events().map((e) => [e.agent, e.model]),
    [["claude", "sonnet"]],
  );
  assert.equal(f.state().tasks[0]?.assignment.model, "sonnet");
});
