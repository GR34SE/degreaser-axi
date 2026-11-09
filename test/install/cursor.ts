import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { stopCursorAt } from "../live/support/cursor-process.ts";

import type { InstallContext } from "./fixture.ts";

function digestBytes(bytes: Buffer | null | undefined) {
  return bytes ? createHash("sha256").update(bytes).digest("hex") : null;
}

function digest(path: string) {
  return existsSync(path) ? digestBytes(readFileSync(path)) : null;
}

function cursorProjects() {
  const dir = join(homedir(), ".cursor", "projects");
  return existsSync(dir) ? readdirSync(dir) : [];
}

/** Native startup refreshes these cache clocks, not user settings. */
export function cursorSettings(bytes: Buffer | null | undefined) {
  if (!bytes) return null;
  const data = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  for (const key of [
    "privacyCache",
    "serverConfigCache",
    "autoReviewAvailabilityCache",
  ]) {
    const value = data[key];
    if (value && typeof value === "object" && !Array.isArray(value))
      delete (value as Record<string, unknown>).updatedAt;
  }
  return data;
}

export function removeCreatedProjectRecords(
  directory: string,
  fixtureRoot: string,
  previous: ReadonlySet<string>,
) {
  if (!existsSync(directory)) return 0;
  const owned = readdirSync(directory).filter(
    (name) =>
      !previous.has(name) &&
      name.toLowerCase().includes(basename(fixtureRoot).toLowerCase()),
  );
  for (const name of owned)
    rmSync(join(directory, name), { recursive: true, force: true });
  return owned.length;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function checkCursor(context: InstallContext) {
  const { root, home, cwd, env, cli, evidence, sync, acceptedNative } = context;

  const found: Record<string, unknown> = {};
  evidence.cursor = found;
  const accepted = acceptedNative(
    "cursor",
    sync("cursor-agent", ["--version"]),
  );
  found.version = accepted.version;
  if (accepted.notice) found.notice = accepted.notice;
  const userRepo = join(root, "cursor-user");
  mkdirSync(userRepo);
  sync("git", ["init", "-q", userRepo]);
  const userSetup = spawnSync(
    process.execPath,
    [
      cli,
      "setup",
      "hooks",
      "--harnesses",
      "cursor",
      "--installation-scope",
      "user",
    ],
    { cwd: userRepo, env, encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(userSetup.status, 0, userSetup.stdout + userSetup.stderr);
  const userHook = join(home, ".cursor", "hooks.json");
  const userSkill = join(home, ".agents", "skills", "degreaser", "SKILL.md");
  assert.equal(
    JSON.parse(readFileSync(userHook, "utf8")).hooks.sessionStart.length,
    1,
  );
  assert.match(readFileSync(userSkill, "utf8"), /^---\nname: degreaser\n/);
  found.disposableUserInstall = {
    hook: true,
    skill: true,
    cliDiscovery: false,
    reason:
      "A disposable HOME is logged out, so this proves the files Cursor loads, not that the logged-in CLI read them.",
  };
  const project = spawnSync(
    process.execPath,
    [
      cli,
      "setup",
      "hooks",
      "--harnesses",
      "cursor",
      "--installation-scope",
      "project",
    ],
    { cwd, env, encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(project.status, 0, project.stdout + project.stderr);
  const hookPath = join(cwd, ".cursor", "hooks.json");
  const settings = JSON.parse(readFileSync(hookPath, "utf8")) as {
    version: number;
    hooks: { sessionStart: { command: string }[] };
  };
  const installed = settings.hooks.sessionStart[0]?.command ?? "";
  assert.equal(settings.version, 1);
  assert.equal(settings.hooks.sessionStart.length, 1);
  assert.match(installed, /startup-context --cursor/);
  assert.match(
    readFileSync(
      join(cwd, ".agents", "skills", "degreaser", "SKILL.md"),
      "utf8",
    ),
    /^---\nname: degreaser\n/,
  );
  const direct = spawnSync("/bin/sh", ["-c", installed], {
    cwd,
    env: { ...env, DEGREASER_WORKER: "" },
    input: JSON.stringify({
      session_id: "install-check",
      is_background_agent: false,
      workspace_roots: [cwd],
    }),
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(direct.status, 0, direct.stderr);
  const payload = JSON.parse(direct.stdout) as {
    additional_context?: string;
  };
  assert.match(payload.additional_context ?? "", /codex\/gpt-6-luna/);
  assert.match(payload.additional_context ?? "", /No local run yet/);
  const sentinel = join(cwd, "cursor-session-start");
  const marker = join(cwd, ".cursor", "mark.sh");
  writeFileSync(
    marker,
    `#!/bin/sh\nprintf HOOK > '${sentinel.replaceAll("'", "'\\''")}'\n`,
  );
  settings.hooks.sessionStart.push({ command: `/bin/sh ${marker}` });
  writeFileSync(hookPath, `${JSON.stringify(settings, null, 2)}\n`);
  assert.equal(settings.hooks.sessionStart[0]?.command, installed);
  const userHooks = join(homedir(), ".cursor", "hooks.json");
  const userConfig = join(homedir(), ".cursor", "cli-config.json");
  const snapshots = [userHooks, userConfig].map((path) => ({
    path,
    bytes: existsSync(path) ? readFileSync(path) : null,
  }));
  const projectsBefore = new Set(cursorProjects());
  const cursorEnv = { ...process.env };
  delete cursorEnv.DEGREASER_WORKER;
  // script(1) closes stdin and the CLI exits before sessionStart. Hold a PTY open.
  const child = spawn(
    "python3",
    [
      "-c",
      `
import os, pty, sys
directory = sys.argv[1]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(directory)
    env = os.environ.copy()
    env.pop("DEGREASER_WORKER", None)
    os.execvpe("cursor-agent", ["cursor-agent", "--mode", "ask", "--sandbox", "enabled", "--trust"], env)
while True:
    try:
        os.read(fd, 4096)
    except OSError:
        break
`,
      cwd,
    ],
    { env: cursorEnv, detached: true, stdio: "ignore" },
  );
  let ran = false;
  try {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (existsSync(sentinel) && readFileSync(sentinel, "utf8") === "HOOK") {
        ran = true;
        break;
      }
      if (child.exitCode !== null) break;
      await sleep(200);
    }
  } finally {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {}
    }
    stopCursorAt(cwd);
    await sleep(200);
    const removed = removeCreatedProjectRecords(
      join(homedir(), ".cursor", "projects"),
      root,
      projectsBefore,
    );
    found.native = {
      sessionStartExecuted: ran,
      installedCommandPreserved: true,
      directAdditionalContext: true,
      trustRecordsRemoved: removed,
      userHooksUnchanged:
        digest(userHooks) === digestBytes(snapshots[0]?.bytes),
      userSettingsUnchanged: isDeepStrictEqual(
        cursorSettings(snapshots[1]?.bytes),
        cursorSettings(
          existsSync(userConfig) ? readFileSync(userConfig) : null,
        ),
      ),
      nativeCacheTimestampsRefreshed:
        digest(userConfig) !== digestBytes(snapshots[1]?.bytes),
    };
  }
  assert.equal(
    ran,
    true,
    "Cursor CLI did not execute the project sessionStart hook",
  );
  assert.equal(
    (found.native as { userHooksUnchanged: boolean }).userHooksUnchanged,
    true,
  );
  assert.equal(
    (found.native as { userSettingsUnchanged: boolean }).userSettingsUnchanged,
    true,
  );
}
