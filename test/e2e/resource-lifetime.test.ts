import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readdirSync,
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

test("an admitted review keeps its instructions, rubric and schemas when packaged resources become unavailable", async (t) => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const installed = realpathSync(
    mkdtempSync(join(tmpdir(), "degreaser-resource-lifetime-")),
  );
  cpSync(join(root, "dist"), join(installed, "dist"), { recursive: true });
  cpSync(join(root, "package.json"), join(installed, "package.json"));
  symlinkSync(
    join(root, "node_modules"),
    join(installed, "node_modules"),
    "dir",
  );
  const f = queueFixture(t, {}, join(installed, "dist/main.js"));
  t.after(() => rmSync(installed, { recursive: true, force: true }));
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
      {
        env: {
          QA_PROFILE: join(
            installed,
            "dist/modules/harness/common/build-profile.js",
          ),
        },
      },
    ),
  );
  await Promise.race([
    until(
      () => f.events().length === 1,
      "Finder started with installed resources",
    ),
    caller.then((done) =>
      assert.fail(
        `Caller exited before inference: ${done.stdout}${done.stderr}`,
      ),
    ),
  ]);
  const resources = readdirSync(join(installed, "dist"), {
    recursive: true,
    withFileTypes: true,
  })
    .filter(
      (entry) => entry.isFile() && /\.(md|schema\.json)$/.test(entry.name),
    )
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return { path, bytes: readFileSync(path) };
    });
  let done: Awaited<typeof caller>;
  try {
    for (const resource of resources) rmSync(resource.path);
    f.release("continue");
    done = await caller;
  } finally {
    for (const resource of resources)
      writeFileSync(resource.path, resource.bytes);
  }
  assert.equal(done.code, 0, done.stdout + done.stderr);
  assert.equal(f.state().status, "completed");
  const task = f.state().tasks[0];
  assert.deepEqual(task?.result?.examinedPaths?.sort(), [
    "other.ts",
    "source.ts",
  ]);
  assert.equal(task?.result?.findings[0]?.verdict, "upheld");
  assert.equal(task?.attempts.find((a) => a.stage === "find")?.rounds, 2);
});
