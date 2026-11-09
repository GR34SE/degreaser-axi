import { spawn } from "node:child_process";
import { descendants, stopDiscovery } from "./provider-ownership.mjs";

const INHERITED = [
  "HOME",
  "PATH",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "USER",
  "LOGNAME",
  "SHELL",
  "TZ",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "PI_CODING_AGENT_DIR",
];

export function environment(overrides = {}) {
  if (process.env.DEGREASER_WORKER)
    throw new Error("Evaluation is blocked in worker-marked callers.");
  const env = Object.fromEntries(
    INHERITED.filter((key) => process.env[key] !== undefined).map((key) => [
      key,
      process.env[key],
    ]),
  );
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value !== "string")
      throw new Error("Provider env values must be strings.");
    env[key] = value;
  }
  return env;
}

export function execute(
  command,
  args,
  {
    cwd,
    env,
    timeoutMs,
    input,
    maxBytes = 134217728,
    preserveChildren = () => false,
  },
) {
  if (timeoutMs <= 0) return Promise.reject(new Error("Evaluation timeout."));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [],
      stderr = [];
    let size = 0,
      failure,
      killTimer,
      cleanup = Promise.resolve();
    const stop = (message) => {
      if (failure) return;
      failure = new Error(message);
      try {
        if (!preserveChildren()) {
          const owned = descendants(child.pid);
          if (!preserveChildren()) cleanup = stopDiscovery(owned);
        }
      } catch (error) {
        cleanup = Promise.reject(error);
      }
      cleanup.catch(() => {});
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
    };
    const timer = setTimeout(() => stop("Evaluation timeout."), timeoutMs);
    const collect = (chunks) => (chunk) => {
      size += chunk.length;
      if (size > maxBytes)
        stop("Evaluation process output exceeded its limit.");
      else chunks.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", () => {
      failure = new Error("Evaluation process could not start.");
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.on("close", async (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      try {
        await cleanup;
      } catch (error) {
        reject(
          Object.assign(new Error("Evaluation process cleanup failed."), {
            cleanupFailed: true,
            cause: error,
          }),
        );
        return;
      }
      if (failure) reject(failure);
      else
        resolve({
          code,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
        });
    });
  });
}

// Fixed Git argv only: samples never supply commands, hooks or executable config.
export async function git(cwd, args, options) {
  const result = await execute(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "maintenance.auto=false",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { ...options, cwd },
  );
  if (result.code !== 0)
    throw new Error(`Evaluation Git operation failed (${args[0]}).`);
  return result.stdout;
}
