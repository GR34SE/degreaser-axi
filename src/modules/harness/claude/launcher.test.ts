import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../..", import.meta.url));

test("packaged Claude launcher replaces conflicting profile flags and preserves stream controls", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "degreaser-native-"));
  try {
    const consumer = join(cwd, "native");
    await writeFile(
      consumer,
      `#!/usr/bin/env node\nconsole.log(JSON.stringify({args:process.argv.slice(2),marker:process.env.DEGREASER_WORKER}));\n`,
      { mode: 0o755 },
    );
    const result = spawnSync(
      process.execPath,
      [
        join(root, "dist/modules/harness/claude/launcher.js"),
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--tools",
        "Bash",
        "Write",
        "--tools=Edit",
        "--settings",
        '{"hooks":{"SessionStart":[]}}',
        "--setting-sources=user,project",
        "--mcp-config",
        '{"mcpServers":{"bad":{}}}',
        "--allowedTools",
        "Bash",
        "--permission-mode",
        "bypassPermissions",
        "--fallback-model",
        "other",
        "--model",
        "other",
        "--resume",
        "control-id",
        "--max-turns",
        "3",
      ],
      {
        cwd,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          DEGREASER_NATIVE_EXECUTABLE: consumer,
          DEGREASER_MODEL: "exact-model",
          DEGREASER_WORKER: "1",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const { args, marker } = JSON.parse(result.stdout);
    const option = (name: string) => args[args.indexOf(name) + 1];
    assert.equal(marker, "1");
    assert.equal(option("--tools"), "Read,Grep,Glob");
    assert.equal(option("--setting-sources"), "");
    assert.deepEqual(JSON.parse(option("--settings")), {
      disableAllHooks: true,
      apiKeyHelper: "",
    });
    assert.deepEqual(JSON.parse(option("--mcp-config")), { mcpServers: {} });
    assert.equal(option("--permission-mode"), "default");
    assert.equal(option("--model"), "exact-model");
    assert.equal(option("--resume"), "control-id");
    assert.equal(option("--max-turns"), "3");
    assert.equal(option("--input-format"), "stream-json");
    assert.equal(option("--output-format"), "stream-json");
    assert.equal(args.filter((a: string) => a === "--tools").length, 1);
    assert.ok(
      args.includes("--safe-mode") &&
        args.includes("--disable-slash-commands") &&
        args.includes("--strict-mcp-config"),
    );
    assert.ok(!args.includes("--fallback-model") && !args.includes("Bash"));
    const discovery = spawnSync(
      process.execPath,
      [
        join(root, "dist/modules/harness/claude/launcher.js"),
        "--model",
        "unsupported-id",
        "--tools",
        "Bash",
      ],
      {
        cwd,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          DEGREASER_NATIVE_EXECUTABLE: consumer,
          DEGREASER_MODEL: "unsupported-id",
          DEGREASER_MODEL_DISCOVERY: "1",
        },
      },
    );
    assert.equal(discovery.status, 0, discovery.stderr);
    const discoveredArgs = JSON.parse(discovery.stdout).args;
    assert.ok(
      !discoveredArgs.includes("--model") &&
        !discoveredArgs.includes("unsupported-id"),
    );
    assert.equal(
      discoveredArgs[discoveredArgs.indexOf("--tools") + 1],
      "Read,Grep,Glob",
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
