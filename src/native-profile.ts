import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Agent, Identity } from "./config.ts";
import { DiagnosticError } from "./diagnostics.ts";
import {
  assertNativeVersion,
  SUPPORTED_NATIVE_VERSIONS,
} from "./native-compatibility.ts";
import { workerEnvironment } from "./native-environment.ts";

const require = createRequire(import.meta.url);
export const codexConfig = {
  sandbox_mode: "read-only",
  approval_policy: "never",
  forced_login_method: "chatgpt",
  model_provider: "openai",
  project_doc_max_bytes: 0,
  web_search: "disabled",
  mcp_servers: {},
  hooks: {},
  features: {
    hooks: false,
    multi_agent: false,
    apps: false,
    code_mode_host: true,
  },
};
const adapters = {
  codex: ["@agentclientprotocol/codex-acp", "2.5.0"],
  claude: ["@agentclientprotocol/claude-agent-acp", "0.95.0"],
  pi: ["pi-acp", "0.0.33"],
} as const;
export interface NativeProfile extends Identity {
  command: string[];
  environment: Record<string, string>;
  adapterVersion: string;
  nativeVersion: string;
  limitations: string[];
}
export const PROFILE_LIMITATIONS: Record<Agent, string[]> = {
  codex: [
    "Native read-only filesystem sandbox permits shell/code execution for reads, not a universal no-exec sandbox.",
    "User skills and managed host policy may remain visible; repository instructions are untrusted evidence.",
    "Native harness session/cache writes are outside the reviewed source.",
  ],
  claude: [
    "Native Read/Grep/Glob allowlist is not an OS sandbox for the adapter.",
    "Managed host policy is retained; conflicting policy blocks operation. Harmless plugin metadata may remain.",
    "Claude's review catalog includes the requested model; its identity check does not prove provider availability.",
    "Native harness session/cache writes are outside the reviewed source.",
  ],
  pi: [
    "Native read/grep/find/ls allowlist is not an OS sandbox for the adapter.",
    "Offline suppresses startup discovery, not subscription model traffic.",
    "Native harness session/cache writes are outside the reviewed source.",
  ],
  cursor: [
    "Ask mode is native read-only behavior, not an OS sandbox around the ACP process.",
    "Repository rules (AGENTS.md, CLAUDE.md), project MCP, hooks, plugins and skills may remain visible; repository instructions are untrusted evidence.",
    "Native harness session/cache writes are outside the reviewed source.",
  ],
};

async function nativeVersion(
  executable: string,
  env: Record<string, string>,
  signal?: AbortSignal,
  spawned?: () => void,
): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--version"], {
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

async function nativeExecutable(
  agent: Agent,
  names: readonly string[],
  env: Record<string, string>,
  signal?: AbortSignal,
  spawned?: () => void,
): Promise<{ path: string; version: string }> {
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
        `Install or expose the supported ${agent} ${SUPPORTED_NATIVE_VERSIONS[agent]} on PATH, then run degreaser-axi doctor. Login and model availability have not been checked.`,
      ],
      { agent, supportedNativeVersion: SUPPORTED_NATIVE_VERSIONS[agent] },
    );
  const stdout = await nativeVersion(executable, env, signal, spawned);
  const version = assertNativeVersion(
    agent,
    stdout.trim().split(/\s+/)[0] ?? "",
  );
  return { path: executable, version };
}

export async function nativeProfile(
  identity: Identity,
  purpose: "review" | "model-discovery" = "review",
  signal?: AbortSignal,
  spawned?: () => void,
): Promise<NativeProfile> {
  if (
    purpose === "review" &&
    (!identity.model ||
      /[\s\0]/.test(identity.model) ||
      identity.model.startsWith("-"))
  )
    throw new Error("An exact model ID is required.");
  if (
    purpose === "review" &&
    identity.agent === "pi" &&
    !/^[^/]+\/[^/]+$/.test(identity.model)
  )
    throw new Error("Pi requires a provider-qualified model ID.");
  const environment = workerEnvironment(process.env);
  environment.DEGREASER_MODEL = identity.model;
  if (purpose === "model-discovery")
    environment.DEGREASER_MODEL_DISCOVERY = "1";
  const launcher = fileURLToPath(
    new URL(`../bin/${identity.agent}-worker.js`, import.meta.url),
  );
  const agent = identity.agent;
  if (agent === "cursor") {
    const native = await nativeExecutable(
      agent,
      ["cursor-agent", "agent"],
      environment,
      signal,
      spawned,
    );
    environment.DEGREASER_NATIVE_EXECUTABLE = native.path;
    return {
      ...identity,
      command: [process.execPath, launcher],
      environment,
      adapterVersion: "native-acp",
      nativeVersion: native.version,
      limitations: [...PROFILE_LIMITATIONS.cursor],
    };
  }
  const [pkg, version] = adapters[agent];
  let manifestPath: string;
  try {
    manifestPath = require.resolve(`${pkg}/package.json`);
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        error.code === "MODULE_NOT_FOUND"
      )
    )
      throw error;
    throw new DiagnosticError(
      "missing-dependency",
      `The pinned ${identity.agent} adapter is missing.`,
      [
        "Restore the installed Degreaser package and its pinned dependencies, then run degreaser-axi doctor.",
      ],
    );
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    version: string;
    bin: Record<string, string>;
  };
  if (manifest.version !== version)
    throw new DiagnosticError(
      "unsupported-adapter-version",
      "Installed adapter version differs from the pinned worker profile.",
      [
        "Restore the installed Degreaser package and its pinned dependencies. Do not update the native host or switch models.",
      ],
    );
  const entry = Object.values(manifest.bin)[0];
  if (!entry) throw new Error("Installed adapter executable is unavailable.");
  let nativeVersion = SUPPORTED_NATIVE_VERSIONS.codex;
  if (agent === "codex") {
    const adapterRequire = createRequire(manifestPath);
    const nativeManifest = JSON.parse(
      await readFile(
        adapterRequire.resolve("@openai/codex/package.json"),
        "utf8",
      ),
    ) as { version: string };
    nativeVersion = assertNativeVersion("codex", nativeManifest.version);
    environment.CODEX_PATH = launcher;
    environment.INITIAL_AGENT_MODE = "read-only";
    environment.CODEX_CONFIG = JSON.stringify(codexConfig);
  } else {
    const native = await nativeExecutable(
      agent,
      [agent],
      environment,
      signal,
      spawned,
    );
    environment.DEGREASER_NATIVE_EXECUTABLE = native.path;
    nativeVersion = native.version;
    if (agent === "claude") {
      environment.CLAUDE_CODE_EXECUTABLE = launcher;
      environment.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
      environment.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION = "false";
      environment.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
    } else environment.PI_ACP_PI_COMMAND = launcher;
  }
  return {
    ...identity,
    command: [process.execPath, join(dirname(manifestPath), entry)],
    environment,
    adapterVersion: version,
    nativeVersion,
    limitations: [...PROFILE_LIMITATIONS[agent]],
  };
}
