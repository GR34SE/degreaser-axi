import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { tmpdir } from "node:os";

import { join } from "node:path";

import type { TestContext } from "node:test";

import { fileURLToPath } from "node:url";

import { stripVTControlCharacters } from "node:util";

import { fixture } from "./git-fixture.ts";

export const cli = fileURLToPath(
  new URL("../../dist/main.js", import.meta.url),
);

export const loader = fileURLToPath(
  new URL("./synthetic-runtime.mjs", import.meta.url),
);

export const pty = fileURLToPath(
  new URL("../fixtures/init-pty.py", import.meta.url),
);

export const defaultSettings = {
  concurrency: null,
  maxRetries: 1,
  limits: {
    workerTimeoutSeconds: 300,
    workerIdleSeconds: 120,
    maxTurns: 40,
    runTimeoutSeconds: 900,
  },
  aspects: {
    "unnecessary-complexity": true,
    "masked-errors": true,
    "verification-theater": true,
    "contract-bypass": true,
    "incomplete-integration": true,
    "low-value-tests": true,
    "scope-creep": true,
    "reinvented-infrastructure": true,
    "missed-reuse": true,
    "wrong-abstraction": true,
    "structural-erosion": true,
    "speculative-flexibility": true,
    "unnecessary-layers": true,
    "unjustified-defense": true,
    "convention-drift": true,
    "unidiomatic-code": true,
    "low-value-comments": true,
  },
  exclude: [],
};

export const explicit = [
  "--agent",
  "codex",
  "--model",
  "gpt-6-luna",
  "--harnesses",
  "claude,pi",
];

export function snapshot(root: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() || entry.isDirectory())
      .map((entry) => [
        join(entry.parentPath, entry.name).slice(root.length),
        entry.isDirectory()
          ? "directory"
          : readFileSync(join(entry.parentPath, entry.name)).toString("base64"),
      ]),
  );
}

export function setup(t: TestContext, existing = false) {
  const f = fixture(t);
  if (!existing) rmSync(join(f.root, ".degreaserrc.json"));
  const external = realpathSync(mkdtempSync(join(tmpdir(), "degreaser-init-")));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  const home = join(external, "home");
  mkdirSync(home);
  const plan = join(external, "plan.json");
  const log = join(external, "events.jsonl");
  const setPlan = (data: object = {}) =>
    writeFileSync(
      plan,
      JSON.stringify({
        log: join(external, "prompts.jsonl"),
        lifecycleLog: log,
        ...data,
      }),
    );
  setPlan();
  const bin = join(external, "bin");
  mkdirSync(bin);
  for (const agent of ["codex", "claude", "pi"])
    writeFileSync(join(bin, agent), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: join(home, ".codex"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PI_CODING_AGENT_DIR: join(home, ".pi/agent"),
    PATH: `${bin}:/usr/bin:/bin`,
    TERM: "xterm-256color",
    CI: "",
    SYNTHETIC_PLAN: plan,
  };
  const run = (
    args: string[] = [],
    answers?: [string | { file: string; contains: string }, string][],
  ) => {
    const result = answers
      ? spawnSync(
          "python3",
          [
            "-B",
            pty,
            JSON.stringify(answers),
            process.execPath,
            "--import",
            loader,
            cli,
            "init",
            ...args,
          ],
          { cwd: f.root, env, encoding: "utf8", timeout: 30_000 },
        )
      : spawnSync(
          process.execPath,
          ["--import", loader, cli, "init", ...args],
          { cwd: f.root, env, encoding: "utf8", timeout: 30_000 },
        );
    assert.equal(result.error, undefined);
    return { ...result, stdout: stripVTControlCharacters(result.stdout) };
  };
  const events = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
  const unchanged = () => ({ repo: snapshot(f.root), home: snapshot(home) });
  const config = () =>
    JSON.parse(readFileSync(join(f.root, ".degreaserrc.json"), "utf8"));
  return { ...f, env, home, bin, log, run, events, setPlan, unchanged, config };
}

export const integrations: [string, string] = [
  "Which agents do you want to install to?",
  "\r",
];

export const project: [string, string] = ["Installation scope", "\r"];

export const skill: [string, string] = ["get the Degreaser skill?", "\r"];

export const acceptAgent: [string, string] = [
  "agent should run the reviews?",
  "\r",
];

export const acceptModel: [string, string] = ["Search models", "\r"];

export const install: [string, string] = ["Proceed with installation?", "\r"];
