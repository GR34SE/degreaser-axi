import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { prepareReview } from "../src/input.ts";
import { assemblePrompt, reviewIdentity } from "../src/prompt.ts";
import { loadInput } from "../src/storage.ts";
import { fixture } from "./git-fixture.ts";
import { queueFixture } from "./queue-fixture.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

test("earlier development fingerprints remain readable history rather than blocking new reviews", (t) => {
  const f = queueFixture(t);
  f.start(["--aspects", "A06"]);
  assert.equal(f.finish().status, 0);
  const run = f.state();
  const directory = join(f.root, ".degreaser/runs", run.id);
  const input = JSON.parse(
    readFileSync(join(directory, "input/review.json"), "utf8"),
  );
  // The earlier development format hashed the whole serialized input.
  run.identity = createHash("sha256")
    .update(
      JSON.stringify({
        input,
        prompts: run.tasks.map((task) => task.promptHash),
      }),
    )
    .digest("hex");
  const path = join(directory, "run.json");
  writeFileSync(path, JSON.stringify(run));
  const before = readFileSync(path);
  const report = f.run(["report", run.id]);
  assert.equal(report.status, 0, report.stdout);
  const resume = f.run(["resume", run.id]);
  assert.equal(resume.status, 2, resume.stdout);
  assert.match(resume.stdout, /input-changed/);
  f.start(["--aspects", "A06"]);
  assert.equal(f.finish().status, 0);
  assert.notEqual(f.state().id, run.id);
  assert.deepEqual(readFileSync(path), before);
});

test("review fingerprint ignores independent execution controls but distinguishes each review identity component", (t) => {
  const f = fixture(t);
  f.write("source.ts", "export const value = 1;\n");
  const input = prepareReview(
    ["--scope", "worktree", "--task", "Update", "--aspects", "A06"],
    f.root,
  );
  const fingerprint = (value: typeof input) =>
    reviewIdentity(value, [
      assemblePrompt(value, "A06", "/same/patch.json").promptHash,
    ]);
  const original = fingerprint(input);
  const controls = [
    (v: typeof input) => {
      v.waitSeconds++;
    },
    (v: typeof input) => {
      v.config.concurrency = 2;
    },
    (v: typeof input) => {
      v.config.limits.runTimeoutSeconds++;
    },
    (v: typeof input) => {
      v.config.limits.workerTimeoutSeconds++;
    },
  ];
  for (const change of controls) {
    const value = structuredClone(input);
    change(value);
    assert.equal(fingerprint(value), original);
  }
  const identities = [
    (v: typeof input) => {
      v.repository += "-other";
    },
    (v: typeof input) => {
      v.scope = "repository";
    },
    (v: typeof input) => {
      v.base = "1".repeat(40);
    },
    (v: typeof input) => {
      v.tree = "2".repeat(40);
    },
    (v: typeof input) => {
      v.task += " changed";
    },
    (v: typeof input) => {
      const a = v.config.assignments[0];
      assert.ok(a);
      a.agent = "claude";
    },
    (v: typeof input) => {
      const a = v.config.assignments[0];
      assert.ok(a);
      a.model = "different-model";
    },
    (v: typeof input) => {
      v.config.limits.maxTurns++;
    },
  ];
  for (const change of identities) {
    const value = structuredClone(input);
    change(value);
    assert.notEqual(fingerprint(value), original);
  }
});

test("public resume independently re-resolves tracked content, new files, task-file and exact execution identities before any write or launch", (t) => {
  const f = queueFixture(t);
  f.git("add", "source.ts");
  f.git("commit", "-m", "Tracked source");
  f.write("source.ts", "// redundant\nexport const value = 2;\n");
  const taskFile = f.gate("brief.txt");
  writeFileSync(taskFile, "Update source\nwithout changing its API.");
  f.setPlan({ worker: { result: "" } });
  f.run([
    "review",
    "--scope",
    "worktree",
    "--task-file",
    taskFile,
    "--aspects",
    "A06",
    "--wait",
    "20",
  ]);
  const run = f.state();
  const directory = join(f.root, ".degreaser/runs", run.id);
  const files = ["run.json", "input/review.json", "input/patch.json"];
  const before = files.map((path) => readFileSync(join(directory, path)));
  const source = readFileSync(join(f.root, "source.ts"));
  const config = readFileSync(join(f.root, ".degreaserrc.json"), "utf8");
  const brief = readFileSync(taskFile);
  const cases = [
    () => f.write("source.ts", "export const value = 3;\n"),
    () => f.write("new.ts", "export const added = true;\n"),
    () => writeFileSync(taskFile, "A different task"),
    () =>
      f.write(
        ".degreaserrc.json",
        JSON.stringify({
          ...JSON.parse(config),
          agent: "claude",
          model: "claude-haiku-4-5-20251001",
        }),
      ),
    () =>
      f.write(
        ".degreaserrc.json",
        JSON.stringify({ ...JSON.parse(config), model: "exact-codex" }),
      ),
    () =>
      f.write(
        ".degreaserrc.json",
        JSON.stringify({
          ...JSON.parse(config),
          aspects: { overrides: { A06: { model: "exact-codex" } } },
        }),
      ),
  ];
  for (const mutate of cases) {
    mutate();
    const result = f.run(["resume", run.id]);
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stdout, /error: input-changed/);
    assert.match(result.stdout, /review --scope worktree/);
    assert.deepEqual(
      files.map((path) => readFileSync(join(directory, path))),
      before,
    );
    f.write("source.ts", source);
    f.write(".degreaserrc.json", config);
    writeFileSync(taskFile, brief);
    rmSync(join(f.root, "new.ts"), { force: true });
  }
  assert.equal(f.events().length, 1);
});

test("moving an explicit branch base and copying a run to another repository cannot retarget evidence", (t) => {
  const f = queueFixture(t);
  f.git("branch", "target");
  f.git("add", "source.ts");
  f.git("commit", "-m", "Feature source");
  f.setPlan({ worker: { result: "" } });
  f.run([
    "review",
    "--scope",
    "branch",
    "--base",
    "target",
    "--task",
    "Update",
    "--aspects",
    "A06",
    "--wait",
    "20",
  ]);
  const run = f.state();
  const path = join(f.root, ".degreaser/runs", run.id, "run.json");
  const before = readFileSync(path);
  f.git("update-ref", "refs/heads/target", "HEAD");
  const changed = f.run(["resume", run.id]);
  assert.equal(changed.status, 2, changed.stdout);
  assert.match(changed.stdout, /input-changed/);
  assert.deepEqual(readFileSync(path), before);
  const other = queueFixture(t);
  cpSync(join(f.root, ".degreaser"), join(other.root, ".degreaser"), {
    recursive: true,
  });
  const copied = other.run(["resume", run.id]);
  assert.equal(copied.status, 2, copied.stdout);
  assert.match(copied.stdout, /invalid-input/);
  assert.deepEqual(other.events(), []);
  assert.deepEqual(
    readFileSync(join(other.root, ".degreaser/runs", run.id, "run.json")),
    before,
  );
});

test("an alternate installed package refuses independently changed instruction, response, schema and rubric bytes", (t) => {
  const f = queueFixture(t);
  f.setPlan({ worker: { result: "" } });
  f.start(["--aspects", "A06"]);
  assert.equal(f.finish().status, 1);
  const run = f.state();
  const path = join(f.root, ".degreaser/runs", run.id, "run.json");
  const before = readFileSync(path);
  const install = mkdtempSync(join(tmpdir(), "degreaser-freshness-"));
  t.after(() => rmSync(install, { recursive: true, force: true }));
  cpSync(join(root, "dist"), join(install, "dist"), { recursive: true });
  symlinkSync(join(root, "node_modules"), join(install, "node_modules"), "dir");
  writeFileSync(join(install, "package.json"), '{"type":"module"}');
  for (const asset of [
    "worker.md",
    "response.md",
    "schemas/result-v1.json",
    "aspects/a06-low-value-comments.md",
  ]) {
    const file = join(install, "dist/assets", asset);
    const original = readFileSync(file, "utf8");
    writeFileSync(file, `${original}\n `);
    const result = spawnSync(
      process.execPath,
      [join(install, "dist/bin/degreaser-axi.js"), "resume", run.id],
      {
        cwd: f.root,
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stdout, /input-changed/);
    assert.deepEqual(readFileSync(path), before);
    writeFileSync(file, original);
  }
  assert.equal(f.events().length, 1);
});

for (const field of ["wait", "concurrency"] as const) {
  test(`changing only persisted ${field} remains readable and resumable without altering review identity`, (t) => {
    const f = queueFixture(t);
    f.setPlan({ worker: { result: "" } });
    f.start(["--aspects", "A06"]);
    assert.equal(f.finish().status, 1);
    const run = f.state();
    const path = join(f.root, ".degreaser/runs", run.id, "input/review.json");
    const input = JSON.parse(readFileSync(path, "utf8"));
    if (field === "wait") input.waitSeconds = 3;
    else input.config.concurrency = 1;
    writeFileSync(path, JSON.stringify(input));
    assert.doesNotThrow(() => loadInput(run));
    f.setPlan();
    const result = f.run(["resume", run.id, "--wait", "20"]);
    assert.equal(result.status, 0, result.stdout);
    assert.equal(f.state().identity, run.identity);
    assert.equal(f.state().deadline, run.deadline);
  });
}
