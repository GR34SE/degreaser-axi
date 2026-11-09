import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

for (const phase of ["before", "after"]) {
  test(`onboarding evidence rejects Git failure ${phase} init`, async (t) => {
    const { checkOnboarding } = await import(
      new URL("./onboarding.mjs", import.meta.url).href
    );
    const root = mkdtempSync(join(tmpdir(), "degreaser-qa-status-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const repo = join(root, "repo");
    const home = join(root, "home");
    mkdirSync(repo);
    mkdirSync(home);
    const initialized = spawnSync("git", ["init", "-q"], {
      cwd: repo,
      encoding: "utf8",
    });
    assert.equal(initialized.status, 0, initialized.stderr);
    const breakGit = () =>
      writeFileSync(join(repo, ".git/config"), "[broken\n");
    if (phase === "before") breakGit();
    let calls = 0;
    assert.throws(
      () =>
        checkOnboarding({
          repo,
          home,
          run: () => {
            calls += 1;
            assert.equal(
              calls,
              1,
              "must not continue to installation after failed status",
            );
            breakGit();
            return "code: decision-required";
          },
        }),
      /Git status failed/,
    );
    assert.equal(calls, phase === "before" ? 0 : 1);
  });
}

test("compiled CLI completes deterministic init, review and same-run resume", () => {
  const scenario = fileURLToPath(new URL("./scenario.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [scenario], {
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /no model inference/);
});
