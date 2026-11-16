import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { candidate, found } from "../utils/coverage-fixture.ts";
import { capture, queueFixture, until } from "../utils/queue-fixture.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
function project() {
  const dir = mkdtempSync(join(tmpdir(), "degreaser-build-"));
  for (const path of [
    "src",
    "tools",
    "dist",
    "docs",
    "README.md",
    "LICENSE",
    "package.json",
    "tsconfig.json",
    "tsconfig.build.json",
  ])
    cpSync(join(root, path), join(dir, path), {
      recursive: true,
      dereference: true,
    });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
  return dir;
}

test("a failed build preserves the previous executable distribution", (t) => {
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "dist/previous-build"), "previous distribution");
  writeFileSync(
    join(dir, "src/broken.ts"),
    "const value: number = 'wrong';\nexport {value};\n",
  );
  const result = spawnSync(process.execPath, ["tools/build.ts"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /broken\.ts/);
  assert.equal(
    readFileSync(join(dir, "dist/previous-build"), "utf8"),
    "previous distribution",
  );
  const version = spawnSync(process.execPath, ["dist/main.js", "--version"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(version.status, 0, version.stdout + version.stderr);
  assert.equal(version.stdout, "1.0.0\n");
});

test("publishing a build keeps the old CLI usable and an admitted review running", async (t) => {
  const dir = project();
  const first = spawnSync(process.execPath, ["tools/build.ts"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const profile = realpathSync(
    join(dir, "dist/modules/harness/common/build-profile.js"),
  );
  const f = queueFixture(t, {}, join(dir, "dist/main.js"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  f.write("other.ts", "export const other = 1;\n");
  f.setPlan({
    workers: {
      "low-value-comments": {
        rounds: [
          {
            ...found("findings", [candidate("source.ts", "// redundant")], {
              examinedPaths: ["source.ts"],
            }),
            resultGate: f.gate("continue"),
          },
          found("no-findings", [], { examinedPaths: ["other.ts"] }),
        ],
      },
    },
  });
  const caller = capture(
    f.launch(
      [
        "review",
        "--scope",
        "worktree",
        "--task",
        "Update source",
        "--aspects",
        "low-value-comments",
      ],
      { env: { QA_PROFILE: profile } },
    ),
  );
  await until(
    () => f.events().length === 1,
    "Finder started before rebuilding",
  );
  const marker = join(dir, "publishing");
  const release = join(dir, "publish-release");
  const hook = join(dir, "publish-barrier.mjs");
  writeFileSync(
    hook,
    `import fs from "node:fs"; import {syncBuiltinESMExports} from "node:module";
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (/\\/(?:dist|current)$/.test(String(to))) {
        fs.writeFileSync(${JSON.stringify(marker)}, "");
        const until = Date.now() + 20000;
        while (!fs.existsSync(${JSON.stringify(release)})) {
          if (Date.now() > until) throw new Error("Publication barrier timed out");
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
      }
      return rename(from, to);
    }; syncBuiltinESMExports();`,
  );
  const child = spawn(process.execPath, ["--import", hook, "tools/build.ts"], {
    cwd: dir,
    stdio: "pipe",
  });
  const built = capture(child);
  try {
    await until(() => existsSync(marker), "Build reached publication", 20000);
    const version = spawnSync(
      process.execPath,
      [join(dir, "dist/main.js"), "--version"],
      { cwd: dir, encoding: "utf8", timeout: 10000 },
    );
    assert.equal(version.status, 0, version.stdout + version.stderr);
    assert.equal(version.stdout, "1.0.0\n");
  } finally {
    writeFileSync(release, "");
    await built;
  }
  const result = await built;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  f.release("continue");
  const done = await caller;
  assert.equal(done.code, 0, done.stdout + done.stderr);
  assert.equal(f.state().status, "completed");
  assert.equal(f.state().tasks[0]?.result?.findings[0]?.verdict, "upheld");
  assert.equal(
    f.state().tasks[0]?.attempts.find((a) => a.stage === "find")?.rounds,
    2,
  );
});
