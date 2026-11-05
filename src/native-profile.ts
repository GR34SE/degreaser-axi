import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Agent, Identity } from "./config.ts";
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
    "Native harness session/cache writes are outside the reviewed source.",
  ],
  pi: [
    "Native read/grep/find/ls allowlist is not an OS sandbox for the adapter.",
    "Offline suppresses startup discovery, not subscription model traffic.",
    "Native harness session/cache writes are outside the reviewed source.",
  ],
};

async function nativeVersion(
  executable: string,
  env: Record<string, string>,
  signal?: AbortSignal,
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
  agent: "claude" | "pi",
  env: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ path: string; version: string }> {
  let executable: string | undefined;
  for (const directory of (env.PATH ?? "").split(":").filter(isAbsolute)) {
    const path = join(directory, agent);
    try {
      await access(path, constants.X_OK);
      executable = await realpath(path);
      break;
    } catch {
      /* Try the next PATH entry. */
    }
  }
  if (!executable)
    throw new Error(
      `Install ${agent} and authenticate its subscription before review.`,
    );
  const stdout = await nativeVersion(executable, env, signal);
  const [version = ""] = stdout.trim().split(" ");
  // These exact native interfaces were exercised. Refuse unverified flag semantics.
  const supported = agent === "claude" ? "2.1.317" : "1.4.0";
  if (version !== supported)
    throw new Error(
      `Unsupported ${agent} native version; expected ${supported}.`,
    );
  return { path: executable, version };
}

export async function nativeProfile(
  identity: Identity,
  purpose: "review" | "model-discovery" = "review",
  signal?: AbortSignal,
): Promise<NativeProfile> {
  if (
    !identity.model ||
    /[\s\0]/.test(identity.model) ||
    identity.model.startsWith("-")
  )
    throw new Error("An exact model ID is required.");
  if (identity.agent === "pi" && !/^[^/]+\/[^/]+$/.test(identity.model))
    throw new Error("Pi requires a provider-qualified model ID.");
  const [pkg, version] = adapters[identity.agent];
  const manifestPath = require.resolve(`${pkg}/package.json`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    version: string;
    bin: Record<string, string>;
  };
  if (manifest.version !== version)
    throw new Error(
      "Installed adapter version differs from the pinned worker profile.",
    );
  const entry = Object.values(manifest.bin)[0];
  if (!entry) throw new Error("Installed adapter executable is unavailable.");
  const environment = workerEnvironment(process.env);
  environment.DEGREASER_MODEL = identity.model;
  const launcher = fileURLToPath(
    new URL(`../bin/${identity.agent}-worker.js`, import.meta.url),
  );
  let nativeVersion = "0.165.0";
  if (identity.agent === "codex") {
    const adapterRequire = createRequire(manifestPath);
    const nativeManifest = JSON.parse(
      await readFile(
        adapterRequire.resolve("@openai/codex/package.json"),
        "utf8",
      ),
    ) as { version: string };
    if (nativeManifest.version !== nativeVersion)
      throw new Error("Unsupported bundled Codex version; expected 0.165.0.");
    environment.CODEX_PATH = launcher;
    environment.INITIAL_AGENT_MODE = "read-only";
    environment.CODEX_CONFIG = JSON.stringify(codexConfig);
  } else {
    const native = await nativeExecutable(identity.agent, environment, signal);
    environment.DEGREASER_NATIVE_EXECUTABLE = native.path;
    nativeVersion = native.version;
    if (identity.agent === "claude") {
      // Claude advertises an arbitrary --model as a custom catalog entry.
      // Discovery must read its catalog without seeding the requested value.
      if (purpose === "model-discovery")
        environment.DEGREASER_MODEL_DISCOVERY = "1";
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
    limitations: [...PROFILE_LIMITATIONS[identity.agent]],
  };
}
