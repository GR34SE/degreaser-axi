import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fixture } from "./git-fixture.ts";

const script = fileURLToPath(
  new URL("../scripts/release-notes.ts", import.meta.url),
);
const notes = (cwd: string, args: string[]) =>
  spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
  });

test("release notes use only the explicit committed range, without bodies or authors", (t) => {
  const f = fixture(t);
  const base = f.git("rev-parse", "HEAD").trim();
  f.write("package.json", '{"name":"degreaser-axi","version":"0.1.0"}\n');
  f.git("add", "package.json");
  f.git(
    "commit",
    "-m",
    "feat: prepare local artifacts",
    "-m",
    "PRIVATE-BODY-CANARY",
  );
  const head = f.git("rev-parse", "HEAD").trim();
  const before = f.git("status", "--porcelain");
  const first = notes(f.root, ["--since", base]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /# degreaser-axi 0\.1\.0/);
  assert.ok(first.stdout.includes(head));
  assert.ok(first.stdout.includes(base));
  assert.match(first.stdout, /feat: prepare local artifacts/);
  assert.doesNotMatch(first.stdout, /Fixture base|PRIVATE-BODY-CANARY/);
  assert.match(first.stdout, /not published/i);
  assert.equal(notes(f.root, ["--since", base]).stdout, first.stdout);
  assert.equal(f.git("status", "--porcelain"), before);
});

test("release notes reject missing, invalid or nonancestor bases and disclose an empty range", (t) => {
  const f = fixture(t);
  f.write("package.json", '{"name":"degreaser-axi","version":"0.1.0"}\n');
  f.git("add", "package.json");
  f.git("commit", "-m", "Package metadata");
  f.git("branch", "candidate");
  f.git("checkout", "--orphan", "unrelated");
  f.git("commit", "-m", "Unrelated root");
  f.git("checkout", "candidate");
  for (const args of [
    [],
    ["--since", "missing-ref"],
    ["--since", "--all"],
    ["--since", "unrelated"],
  ]) {
    const result = notes(f.root, args);
    assert.notEqual(result.status, 0, args.join(" "));
    assert.equal(result.stdout, "");
  }
  const empty = notes(f.root, ["--since", "HEAD"]);
  assert.equal(empty.status, 0, empty.stderr);
  assert.match(empty.stdout, /No commits in the selected range/);
});
