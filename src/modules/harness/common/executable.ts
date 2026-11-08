import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { DiagnosticError } from "../../../util/errors.ts";
import type { Runtime } from "../../../util/exec/types.ts";
import type { HarnessDefinition } from "../types.ts";
import { acceptedVersions, assertSupportedVersion } from "./versions.ts";

async function nativeVersion(
  runtime: Runtime,
  executable: string,
  env: Record<string, string>,
  signal?: AbortSignal,
  spawned?: () => void,
): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = runtime.spawn(executable, ["--version"], {
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      bytes = 0,
      failure: unknown;
    const stop = () => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (
          !(error instanceof Error && "code" in error && error.code === "ESRCH")
        )
          failure ??= error;
      }
    };
    const abort = () => {
      failure ??= signal?.reason;
      stop();
    };
    child.once("spawn", () => {
      try {
        spawned?.();
      } catch (error) {
        failure = error;
        stop();
      }
    });
    const timer = setTimeout(() => {
      failure ??= Object.assign(new Error("Native version check timed out."), {
        code: "ETIMEDOUT",
      });
      stop();
    }, 10_000);
    const collect = (chunk: Buffer, stdout: boolean) => {
      bytes += chunk.length;
      if (bytes > 4096) {
        failure ??= new Error("Native version output exceeded its limit.");
        stop();
      } else if (stdout) output += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, false));
    child.on("error", (error) => {
      failure ??= error;
    });
    // The group belongs only to this probe, including any native helper processes.
    child.on("exit", stop);
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error("Native version check failed."));
      else resolve(output);
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function nativeExecutable(
  runtime: Runtime,
  definition: HarnessDefinition,
  env: Record<string, string>,
  signal?: AbortSignal,
  spawned?: () => void,
): Promise<{ path: string; version: string; notice?: string }> {
  const { id: agent, executables: names } = definition;
  let executable: string | undefined;
  let denied: unknown;
  for (const directory of (env.PATH ?? "").split(":").filter(isAbsolute)) {
    if (executable) break;
    for (const name of names) {
      const path = join(directory, name);
      try {
        await access(path, constants.X_OK);
        executable = await realpath(path);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EACCES" || code === "EPERM") denied ??= error;
        else if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      }
    }
  }
  if (!executable && denied) throw denied;
  if (!executable)
    throw new DiagnosticError(
      "missing-dependency",
      `The ${agent} executable was not found on absolute PATH entries.`,
      [
        `Install or expose a supported ${agent} (${acceptedVersions(definition)}) on PATH, then run degreaser-axi doctor. Login and model availability have not been checked.`,
      ],
      { agent, supportedNativeVersion: definition.supportedVersions.verified },
    );
  const stdout = await nativeVersion(runtime, executable, env, signal, spawned);
  const { version, notice } = assertSupportedVersion(
    definition,
    stdout.trim().split(/\s+/)[0] ?? "",
  );
  return { path: executable, version, ...(notice ? { notice } : {}) };
}
