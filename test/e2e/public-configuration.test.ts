import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";

import { join } from "node:path";

import test from "node:test";

import { ASPECT_IDS } from "../../src/modules/aspect/api.ts";

import { args, setup } from "../utils/public-review-fixture.ts";

test("public configuration is strict, root-local and rejects finite invalid values without side effects", (t) => {
  const f = setup(t);
  f.write("nested/brief", "First line\nSecond line\n");
  f.write("nested/.degreaserrc.json", '{"agent":"droid"}');
  f.write(
    ".degreaserrc.json",
    '{"agent":"codex","model":"gpt-6-luna","maxRetries":0,"concurrency":null}',
  );
  assert.equal(
    f.run(
      [
        "review",
        "--scope",
        "worktree",
        "--task-file",
        "brief",
        "--aspects",
        "low-value-comments",
      ],
      join(f.root, "nested"),
    ).status,
    0,
  );
  assert.equal(f.input().task, "First line\nSecond line\n");
  assert.equal(f.input().config.concurrency, null);
  const runs = readdirSync(join(f.root, ".degreaser/runs")),
    count = f.events().length;
  const valid = { agent: "codex", model: "gpt-6-luna" };
  for (const rc of [
    {},
    { agent: "codex" },
    { model: "gpt-6-luna" },
    { ...valid, caller: "codex" },
    { ...valid, schemaVersion: 2 },
    ...["droid", "grok"].map((agent) => ({ ...valid, agent })),
    ...[0, -1, 1.5, "2"].map((concurrency) => ({
      ...valid,
      concurrency,
    })),
    ...[-1, null, 1.5].map((maxRetries) => ({ ...valid, maxRetries })),
    ...[0, -1, null, "40"].flatMap((value) =>
      ["workerTimeoutSeconds", "runTimeoutSeconds", "maxTurns"].map((key) => ({
        ...valid,
        limits: { [key]: value },
      })),
    ),
    { ...valid, limits: { unknown: 2 } },
    { ...valid, aspects: { custom: [] } },
    { ...valid, plugins: [] },
    {
      ...valid,
      aspects: { "missed-reuse": { agent: "claude" } },
    },
    {
      ...valid,
      aspects: {
        "missed-reuse": { agent: "pi", model: "unqualified" },
      },
    },
    {
      ...valid,
      aspects: { "missed-reuse": "off" },
    },
    {
      ...valid,
      aspects: Object.fromEntries(ASPECT_IDS.map((id) => [id, false])),
    },
  ]) {
    f.write(".degreaserrc.json", JSON.stringify(rc));
    const result = f.run(args);
    assert.equal(result.status, 2, JSON.stringify(rc) + result.stdout);
    assert.match(result.stdout, /invalid-input/);
  }
  f.write(".degreaserrc.json", "{");
  assert.equal(f.run(args).status, 2);
  assert.deepEqual(readdirSync(join(f.root, ".degreaser/runs")), runs);
  assert.equal(f.events().length, count);
});

test("public default/narrowed/restored selections retain exact overrides and exclusions without RC writes", (t) => {
  const f = setup(t);
  f.write("source.ts", "export const a = 1;\n");
  f.write("package.json", "{}\n");
  f.write("dist/generated", "generated\n");
  f.write("nested/node_modules/a", "dependency\n");
  const all = [...ASPECT_IDS].sort();
  assert.equal(
    f.run(["review", "--scope", "worktree", "--task", "Default"]).status,
    0,
  );
  assert.deepEqual(
    f
      .events()
      .map((e) => e.aspect)
      .sort(),
    all,
  );
  const rc = JSON.stringify({
    agent: "codex",
    model: "gpt-6-luna",
    concurrency: 2,
    maxRetries: 0,
    exclude: ["package.json"],
    aspects: {
      "unnecessary-layers": false,
      "masked-errors": { model: "exact-codex" },
      "contract-bypass": {
        agent: "claude",
        model: "claude-haiku-4-5-20251001",
      },
      "verification-theater": { agent: "pi", model: "openai/gpt-6-luna" },
    },
  });
  f.write(".degreaserrc.json", rc);
  const narrowed = f.run([
    "review",
    "--scope",
    "worktree",
    "--task",
    "Narrow",
    "--aspects",
    "verification-theater,contract-bypass,masked-errors",
    "--concurrency",
    "1",
  ]);
  assert.equal(narrowed.status, 0, narrowed.stdout);
  assert.deepEqual(f.input().workers, [
    { aspect: "masked-errors", agent: "codex", model: "exact-codex" },
    { aspect: "verification-theater", agent: "pi", model: "openai/gpt-6-luna" },
    {
      aspect: "contract-bypass",
      agent: "claude",
      model: "claude-haiku-4-5-20251001",
    },
  ]);
  assert.equal(f.input().config.concurrency, 1);
  assert.deepEqual(
    f.input().paths.map((p: { path: string }) => p.path),
    ["source.ts"],
  );
  assert.doesNotMatch(narrowed.stdout, /context without becoming reviewed/);
  assert.match(
    f.run(["report", "--full"]).stdout,
    /context without becoming reviewed coverage/,
  );
  for (const selection of ["unnecessary-layers", "A99", "reuse-existing", ""])
    assert.equal(
      f.run([
        "review",
        "--scope",
        "worktree",
        "--task",
        "x",
        "--aspects",
        selection,
      ]).status,
      2,
    );
  assert.equal(
    f.run(["review", "--scope", "worktree", "--task", "Restore"]).status,
    0,
  );
  assert.deepEqual(
    f.input().workers.map((w: { aspect: string }) => w.aspect),
    ASPECT_IDS.filter((a) => a !== "unnecessary-layers"),
  );
  assert.equal(readFileSync(join(f.root, ".degreaserrc.json"), "utf8"), rc);
});

test("public multiline task files reject empty input and do not inherit an outside RC", (t) => {
  const f = setup(t);
  for (const text of ["", " \n "]) {
    f.write("brief", text);
    assert.equal(
      f.run(["review", "--scope", "worktree", "--task-file", "brief"]).status,
      2,
    );
  }
  f.write("child/file", "source\n");
  const child = join(f.root, "child");
  assert.equal(spawnSync("git", ["init"], { cwd: child }).status, 0);
  assert.equal(f.run(args, child).status, 2);
  assert.deepEqual(f.events(), []);
  assert.ok(!existsSync(join(child, ".degreaser")));
});

test("public --path narrows a repository audit from the Git root and composes with exclusions", (t) => {
  const f = setup(t);
  f.write(
    ".degreaserrc.json",
    JSON.stringify({
      agent: "codex",
      model: "gpt-6-luna",
      exclude: ["landing/generated"],
    }),
  );
  for (const p of [
    "landing/app/blog.ts",
    "landing/ui/Button.tsx",
    "landing/ui/deep/Card.tsx",
    "landing/generated/schema.ts",
    "landing/dist/out.js",
    "api/server.ts",
    "packages/a/src/index.ts",
    "packages/a/test/index.ts",
  ])
    f.write(p, `export const path = ${JSON.stringify(p)};\n`);
  const audit = (...patterns: string[]) =>
    f.run(
      [
        "review",
        "--scope",
        "repository",
        "--task",
        "Audit the landing page",
        "--aspects",
        "low-value-comments",
        ...patterns.flatMap((p) => ["--path", p]),
      ],
      join(f.root, "api"),
    );
  const assessed = () => f.input().paths.map((p: { path: string }) => p.path);
  const narrowed = audit("landing", "packages/*/src");
  assert.equal(narrowed.status, 0, narrowed.stdout);
  assert.deepEqual(assessed(), [
    "landing/app/blog.ts",
    "landing/ui/Button.tsx",
    "landing/ui/deep/Card.tsx",
    "packages/a/src/index.ts",
  ]);
  assert.deepEqual(f.input().pathPatterns, ["landing", "packages/*/src"]);
  assert.deepEqual(f.input().excludedPaths, [
    "landing/dist/out.js",
    "landing/generated/schema.ts",
  ]);
  assert.match(narrowed.stdout, /packages\/\*\/src/);
  assert.equal(audit("landing/**/*.tsx").status, 0);
  assert.deepEqual(assessed(), [
    "landing/ui/Button.tsx",
    "landing/ui/deep/Card.tsx",
  ]);
  const identity = () => {
    const { latestRunId } = JSON.parse(
      readFileSync(join(f.root, ".degreaser/state.json"), "utf8"),
    );
    return JSON.parse(
      readFileSync(
        join(f.root, ".degreaser/runs", latestRunId, "run.json"),
        "utf8",
      ),
    ).identity;
  };
  assert.equal(audit("landing").status, 0);
  const plain = identity();
  assert.equal(audit("land*").status, 0);
  assert.equal(assessed().length, 3);
  assert.notEqual(identity(), plain);
});

test("public --path rejects unsafe or unmatched patterns before creating a run", (t) => {
  const f = setup(t);
  f.write("landing/app.ts", "export const a = 1;\n");
  const audit = (...patterns: string[]) =>
    f.run([
      "review",
      "--scope",
      "repository",
      "--task",
      "Audit",
      "--aspects",
      "low-value-comments",
      ...patterns.flatMap((p) => ["--path", p]),
    ]);
  for (const patterns of [
    [""],
    ["/landing"],
    [":(exclude)landing"],
    ["./landing"],
    ["landing/../api"],
    ["landing\\app.ts"],
    ["landing/"],
    ["landing", "landing"],
    ["missing/**", "docs"],
  ]) {
    const result = audit(...patterns);
    assert.equal(result.status, 2, `${patterns}: ${result.stdout}`);
    assert.match(result.stdout, /code: invalid-input/);
    assert.ok(!existsSync(join(f.root, ".degreaser")), String(patterns));
  }
  assert.match(audit("missing/**", "docs").stdout, /missing\/\*\*, docs/);
  assert.deepEqual(f.events(), []);
});

test("public --path narrows worktree changes and an unmatched pattern is rejected, not no-changes", (t) => {
  const f = setup(t);
  f.write("landing/app.ts", "old\n");
  f.write("api/server.ts", "old\n");
  f.git("add", ".");
  f.git("commit", "-m", "Base files");
  f.write("landing/app.ts", "new landing\n");
  f.write("api/server.ts", "new api\n");
  const result = f.run([...args, "--path", "landing"]);
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(
    f.input().paths.map((p: { path: string }) => p.path),
    ["landing/app.ts"],
  );
  assert.doesNotMatch(f.input().patch, /new api/);
  rmSync(join(f.root, ".degreaser"), { recursive: true });
  const typo = f.run([...args, "--path", "docs", "--path", "landng"]);
  assert.equal(typo.status, 2, typo.stdout);
  assert.match(typo.stdout + typo.stderr, /--path docs, landng/);
  assert.ok(!existsSync(join(f.root, ".degreaser")));
});
