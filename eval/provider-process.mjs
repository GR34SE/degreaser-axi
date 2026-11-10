import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

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
  return {
    ...env,
    ...overrides,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
}

function processes() {
  const result = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,lstart="], {
    encoding: "utf8",
    env: { LC_ALL: "C" },
    timeout: 1000,
    maxBuffer: 4_194_304,
  });
  if (result.status !== 0)
    throw new Error("Cannot verify evaluation process ownership.");
  return result.stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    return match
      ? [{ pid: Number(match[1]), parent: Number(match[2]), started: match[3] }]
      : [];
  });
}

// acpx starts adapters in their own process groups, so a group kill misses
// them; the start time guards against PID reuse.
function descendants(pid) {
  const rows = processes();
  const owned = new Set([pid]);
  for (let size = 0; size !== owned.size; ) {
    size = owned.size;
    for (const row of rows) if (owned.has(row.parent)) owned.add(row.pid);
  }
  return rows.filter((row) => row.pid !== pid && owned.has(row.pid));
}

async function killAll(captured) {
  const until = Date.now() + 5000;
  for (;;) {
    const alive = processes().filter((row) =>
      captured.some(
        (old) => old.pid === row.pid && old.started === row.started,
      ),
    );
    if (!alive.length) return;
    if (Date.now() >= until)
      throw new Error("Evaluation process cleanup did not finish.");
    for (const row of alive) {
      try {
        process.kill(row.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    await delay(25);
  }
}

export function execute(
  command,
  args,
  { cwd, env, deadline, signal, input, keepDescendants = () => false },
) {
  if (signal?.aborted) return Promise.reject(new Error("Evaluation aborted."));
  if (deadline <= Date.now())
    return Promise.reject(new Error("Evaluation timeout."));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env });
    const stdout = [];
    let size = 0;
    let failure;
    let cleanup = Promise.resolve();
    const stop = (message) => {
      if (failure) return;
      failure = new Error(message);
      // After the review saved state, its detached owner is released through cancel.
      if (!keepDescendants()) {
        try {
          cleanup = killAll(descendants(child.pid));
        } catch (error) {
          cleanup = Promise.reject(error);
        }
        cleanup.catch(() => {});
      }
      child.kill("SIGKILL");
    };
    const timer = setTimeout(
      () => stop("Evaluation timeout."),
      deadline - Date.now(),
    );
    const abort = () => stop("Evaluation aborted.");
    signal?.addEventListener("abort", abort);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 134_217_728)
        stop("Evaluation process output exceeded its limit.");
      else stdout.push(chunk);
    });
    child.stderr.resume();
    child.on("error", () => {
      failure ??= new Error("Evaluation process could not start.");
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.on("close", async (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      try {
        await cleanup;
      } catch {
        reject(
          Object.assign(new Error("Evaluation process cleanup failed."), {
            cleanupFailed: true,
          }),
        );
        return;
      }
      if (failure) reject(failure);
      else resolve({ code, stdout: Buffer.concat(stdout) });
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
