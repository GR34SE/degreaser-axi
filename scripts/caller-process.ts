import { spawn } from "node:child_process";
import { INHERITED_WORKER_ENV } from "../src/native-environment.ts";
import { object } from "./caller-evidence.ts";

export const callerEnvironment = Object.fromEntries(
  INHERITED_WORKER_ENV.flatMap((key) =>
    process.env[key] ? [[key, process.env[key]]] : [],
  ),
);

// Native stdio test driver, not an ACP client. All review workers still use acpx.
export function callerProcess(
  command: string,
  args: string[],
  cwd: string,
  observe: (event: Record<string, unknown>) => void,
  environment: NodeJS.ProcessEnv = {
    ...callerEnvironment,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    PI_TELEMETRY: "0",
  },
) {
  const child = spawn(command, args, {
    cwd,
    env: environment,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  const pending = new Set<{
    match: (event: Record<string, unknown>) => boolean;
    resolve: (event: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  }>();
  let buffer = "",
    bytes = 0;
  let failure: Error | undefined;
  let stopped = false;
  const fail = (error: Error) => {
    failure ??= error;
    for (const p of pending) p.reject(error);
    pending.clear();
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (child.pid)
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
  };
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < 2000) stderr += chunk.toString("utf8");
  });
  const stderrDetail = () =>
    stderr
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]")
      .slice(0, 400);
  child.stdout.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > 16_777_216) {
      fail(new Error("Native event budget exceeded"));
      stop();
      return;
    }
    buffer += chunk.toString("utf8");
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n"),
        line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      let event: Record<string, unknown>;
      try {
        event = object(JSON.parse(line));
      } catch {
        continue;
      }
      try {
        observe(event);
      } catch (error) {
        fail(
          error instanceof Error ? error : new Error("Native observer failed"),
        );
        stop();
        return;
      }
      for (const p of pending)
        if (p.match(event)) {
          pending.delete(p);
          p.resolve(event);
        }
    }
  });
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.on("close", (code) =>
    fail(
      new Error(
        `Native caller closed (${code}) before expected event${stderrDetail() ? `: ${stderrDetail()}` : ""}`,
      ),
    ),
  );
  function wait(
    match: (event: Record<string, unknown>) => boolean,
    ms = 240_000,
  ) {
    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(p);
        reject(new Error("Native event timed out"));
      }, ms);
      const p = {
        match,
        resolve: (e: Record<string, unknown>) => {
          clearTimeout(timer);
          resolve(e);
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      pending.add(p);
    });
    // A turn waiter can be pending while a separate request fails first.
    void result.catch(() => {});
    return result;
  }
  return {
    wait,
    async request(
      value: object,
      match: (event: Record<string, unknown>) => boolean,
    ) {
      const result = wait(match, 30_000);
      child.stdin.write(`${JSON.stringify(value)}\n`);
      return result;
    },
    send(value: object) {
      child.stdin.write(`${JSON.stringify(value)}\n`);
    },
    async close() {
      stop();
      await closed;
    },
  };
}
