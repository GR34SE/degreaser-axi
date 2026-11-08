import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runtime } from "../utils/runtime.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("Pi launcher pins argv model, removes discovery and cannot inherit metered credentials", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "degreaser-native-"));
  try {
    const consumer = join(cwd, "native");
    await writeFile(
      consumer,
      `#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n`,
      { mode: 0o755 },
    );
    const invoke = (extra: Record<string, string> = {}) =>
      spawnSync(
        process.execPath,
        [
          join(root, "dist/modules/harness/pi/launcher.js"),
          "--mode",
          "rpc",
          "--no-themes",
          "--provider",
          "other-provider",
          "--model=other-model",
          "-m",
          "conflicting-model",
        ],
        {
          cwd,
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            DEGREASER_NATIVE_EXECUTABLE: consumer,
            DEGREASER_MODEL: "openai/exact-model",
            ...extra,
          },
        },
      );
    const result = invoke();
    assert.equal(result.status, 0, result.stderr);
    const args = JSON.parse(result.stdout);
    assert.equal(args[args.indexOf("--model") + 1], "openai/exact-model");
    assert.ok(!args.includes("--provider"));
    assert.equal(args.filter((arg: string) => arg === "--model").length, 1);
    assert.equal(args[args.indexOf("--tools") + 1], "read,grep,find,ls");
    for (const flag of [
      "--no-skills",
      "--no-extensions",
      "--no-mcp",
      "--no-context-files",
      "--no-prompt-templates",
      "--offline",
    ])
      assert.ok(args.includes(flag));
    const discovery = invoke({
      DEGREASER_MODEL_DISCOVERY: "1",
      DEGREASER_MODEL: "",
    });
    assert.equal(discovery.status, 0, discovery.stderr);
    assert.deepEqual(
      JSON.parse(discovery.stdout),
      args.filter(
        (arg: string) => arg !== "--model" && arg !== "openai/exact-model",
      ),
    );
    const blocked = invoke({ OPENAI_API_KEY: "synthetic-secret" });
    assert.notEqual(blocked.status, 0);
    assert.ok(!blocked.stderr.includes("synthetic-secret"));
    assert.equal(blocked.stdout, "");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("Cursor launcher pins ask mode, sandbox, model and acp, and cannot inherit API credentials", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "degreaser-native-"));
  try {
    const consumer = join(cwd, "native");
    await writeFile(
      consumer,
      `#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n`,
      { mode: 0o755 },
    );
    const invoke = (extra: Record<string, string> = {}) =>
      spawnSync(
        process.execPath,
        [
          join(root, "dist/modules/harness/cursor/launcher.js"),
          "--mode",
          "agent",
          "--model=other",
          "--force",
          "--yolo",
          "--approve-mcps",
          "--sandbox",
          "disabled",
          "acp",
        ],
        {
          cwd,
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            DEGREASER_NATIVE_EXECUTABLE: consumer,
            DEGREASER_MODEL: "composer-2.5-fast",
            ...extra,
          },
        },
      );
    const result = invoke();
    assert.equal(result.status, 0, result.stderr);
    const args = JSON.parse(result.stdout);
    assert.equal(args.at(-1), "acp");
    assert.equal(args[args.indexOf("--model") + 1], "composer-2.5-fast");
    assert.equal(args[args.indexOf("--mode") + 1], "ask");
    assert.equal(args[args.indexOf("--sandbox") + 1], "enabled");
    assert.ok(args.includes("--trust"));
    assert.equal(args.filter((arg: string) => arg === "acp").length, 1);
    assert.ok(!args.includes("--force") && !args.includes("--yolo"));
    assert.ok(!args.includes("--approve-mcps") && !args.includes("disabled"));
    const discovery = invoke({
      DEGREASER_MODEL_DISCOVERY: "1",
      DEGREASER_MODEL: "",
    });
    assert.equal(discovery.status, 0, discovery.stderr);
    const discovered = JSON.parse(discovery.stdout);
    assert.ok(!discovered.includes("--model"));
    assert.ok(!discovered.includes("composer-2.5-fast"));
    assert.equal(discovered.at(-1), "acp");
    const blocked = invoke({ CURSOR_API_KEY: "synthetic-secret" });
    assert.notEqual(blocked.status, 0);
    assert.ok(!blocked.stderr.includes("synthetic-secret"));
    assert.equal(blocked.stdout, "");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("Cursor native profile uses the worker ACP launcher at the pinned CLI version", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "degreaser-cursor-profile-"));
  const path = process.env.PATH;
  try {
    const bin = join(cwd, "bin");
    await mkdir(bin);
    await writeFile(
      join(bin, "cursor-agent"),
      `#!${process.execPath}\nconsole.log("2026.11.05-86047df");\n`,
      { mode: 0o755 },
    );
    process.env.PATH = `${bin}:/usr/bin:/bin`;
    const {
      nativeProfile,
    }: typeof import("../../src/modules/harness/common/profile.ts") =
      await import(
        new URL("../../dist/modules/harness/common/profile.js", import.meta.url)
          .href
      );
    const profile = await nativeProfile(runtime(), {
      agent: "cursor",
      model: "composer-2.5-fast",
    });
    assert.equal(profile.adapterVersion, "native-acp");
    assert.equal(profile.nativeVersion, "2026.11.05-86047df");
    assert.deepEqual(profile.command, [
      process.execPath,
      join(root, "dist/modules/harness/cursor/launcher.js"),
    ]);
    assert.equal(
      profile.environment.DEGREASER_NATIVE_EXECUTABLE,
      await realpath(join(bin, "cursor-agent")),
    );
    await writeFile(
      join(bin, "cursor-agent"),
      `#!${process.execPath}\nconsole.log("99.0.0");\n`,
      { mode: 0o755 },
    );
    await assert.rejects(
      nativeProfile(runtime(), { agent: "cursor", model: "composer-2.5-fast" }),
      /Unsupported cursor native version/,
    );
  } finally {
    process.env.PATH = path;
    await rm(cwd, { recursive: true, force: true });
  }
});
