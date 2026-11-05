import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  type AcpRuntimeHandle,
  type AcpRuntimeUsageBreakdown,
  type AcpSessionRecord,
  createAcpRuntime,
  createAgentRegistry,
  isAcpRuntimeError,
} from "acpx/runtime";
import { isolatedCommand } from "./native-environment.ts";
import type { NativeProfile } from "./native-profile.ts";

export type WorkerFailure =
  | "model-unavailable"
  | "authentication"
  | "rate-limited"
  | "environment-blocked"
  | "timeout"
  | "cancelled"
  | "runtime"
  | "cleanup"
  | "output-limit";
export interface WorkerRequest {
  cwd: string;
  /** Assembled assignment, task/scope and response contract. Never ambient caller history. */
  prompt: string;
  maxTurns: number;
  timeoutMs: number;
  signal?: AbortSignal;
  onPromptStarted?: () => void;
  onLifecycle?: (event: { type: "spawn" | "exit"; pid: number }) => void;
  onTool?: (event: { kind: string; status: string }) => void;
}
export interface WorkerOutcome {
  status: "completed" | "failed";
  model: string;
  sessionId?: string;
  output: string;
  failure?: WorkerFailure;
  usage: AcpRuntimeUsageBreakdown | null;
  limitations: string[];
}

function failureKind(error: unknown): WorkerFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /model.*(unavailable|unsupported|not found)|ACP_MODEL_UNSUPPORTED/i.test(
      message,
    )
  )
    return "model-unavailable";
  if (/auth|login|credential|unauthorized/i.test(message))
    return "authentication";
  if (/rate.?limit|quota|429/i.test(message)) return "rate-limited";
  if (/permission denied|EACCES|sandbox|policy/i.test(message))
    return "environment-blocked";
  if (/timeout|timed out/i.test(message)) return "timeout";
  return "runtime";
}

/** One fresh runtime/session per attempt. acpx, not this module, owns the process tree. */
export async function executeWorker(
  request: WorkerRequest,
  profile: NativeProfile,
): Promise<WorkerOutcome> {
  if (
    !Number.isSafeInteger(request.timeoutMs) ||
    request.timeoutMs < 1 ||
    request.timeoutMs > 2_147_483_647 ||
    !Number.isSafeInteger(request.maxTurns) ||
    request.maxTurns < 1 ||
    !request.prompt.trim()
  ) {
    throw new Error(
      "Worker requires a nonempty assignment and positive bounded limits.",
    );
  }
  const outcome: WorkerOutcome = {
    status: "failed",
    model: profile.model,
    output: "",
    usage: null,
    limitations: [...profile.limitations],
  };
  if (request.signal?.aborted) return { ...outcome, failure: "cancelled" };
  const records = new Map<string, AcpSessionRecord>();
  const runtime = createAcpRuntime({
    cwd: request.cwd,
    sessionStore: {
      async load(id) {
        return records.get(id);
      },
      async save(record) {
        records.set(record.acpxRecordId, structuredClone(record));
      },
    },
    agentRegistry: createAgentRegistry({
      overrides: { [profile.agent]: isolatedCommand(profile) },
    }),
    agentProcessEnvAllow: [],
    permissionMode: "approve-reads",
    nonInteractivePermissions: "deny",
    fs: false,
    terminal: false,
    mcpServers: [],
    timeoutMs: request.timeoutMs,
    onPermissionRequest: async ({ inferredKind }) => ({
      outcome:
        inferredKind === "read" || inferredKind === "search"
          ? "allow_once"
          : "reject_once",
    }),
    processLifecycle: {
      onBeforeSpawn() {
        if (stopped) throw new Error("Worker admission cancelled.");
      },
      onSpawned(event) {
        request.onLifecycle?.({ type: "spawn", pid: event.pid });
      },
      onExit(event) {
        request.onLifecycle?.({ type: "exit", pid: event.pid });
      },
    },
  });
  let stopped: "timeout" | "cancelled" | undefined;
  let shutdown: Promise<boolean> | undefined;
  const join = () =>
    (shutdown ??= runtime.shutdown().then(
      () => true,
      () => false,
    ));
  const stop = (reason: "timeout" | "cancelled") => {
    stopped ??= reason;
    void join();
  };
  const abort = () => stop("cancelled");
  request.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => stop("timeout"), request.timeoutMs);
  let handle: AcpRuntimeHandle | undefined;
  try {
    if (request.signal?.aborted) stop("cancelled");
    const instruction = (
      await readFile(new URL("../assets/worker.md", import.meta.url), "utf8")
    ).replaceAll("{maxTurns}", String(request.maxTurns));
    handle = await runtime.ensureSession({
      sessionKey: `degreaser-${randomUUID()}`,
      agent: profile.agent,
      mode: "persistent",
      cwd: request.cwd,
      sessionOptions: {
        maxTurns: request.maxTurns,
        systemPrompt: instruction,
        ...(profile.agent === "claude"
          ? { allowedTools: ["Read", "Grep", "Glob"] }
          : {}),
      },
    });
    const sessionId = handle.agentSessionId ?? handle.backendSessionId;
    if (sessionId) outcome.sessionId = sessionId;
    const advertised = await runtime.getStatus({ handle });
    if (!advertised.models?.availableModelIds.includes(profile.model)) {
      outcome.failure = "model-unavailable";
      return outcome;
    }
    if (profile.agent !== "pi")
      await runtime.setModel({ handle, model: profile.model });
    const selected = await runtime.getStatus({ handle });
    if (selected.models?.currentModelId !== profile.model) {
      outcome.failure = "model-unavailable";
      return outcome;
    }
    const turn = runtime.startTurn({
      handle,
      mode: "prompt",
      requestId: randomUUID(),
      text: request.prompt,
      timeoutMs: request.timeoutMs,
      assertActive() {
        if (stopped) throw new Error("Worker admission cancelled.");
      },
    });
    await turn.promptStarted;
    request.onPromptStarted?.();
    for await (const event of turn.events) {
      if (event.type === "text_delta" && event.stream !== "thought") {
        outcome.output += event.text;
        if (outcome.output.length > 1_048_576) {
          outcome.output = "";
          outcome.failure = "output-limit";
          await turn.cancel();
          break;
        }
      }
      if (event.type === "tool_call")
        request.onTool?.({
          kind: event.kind ?? "other",
          status: event.status ?? "unknown",
        });
    }
    const result = await turn.result;
    const status = await runtime.getStatus({ handle });
    outcome.usage = status.usage?.cumulative ?? null;
    if (!outcome.failure) {
      if (result.status === "completed") outcome.status = "completed";
      else
        outcome.failure =
          result.status === "cancelled"
            ? "cancelled"
            : failureKind(new Error(result.error.message));
    }
  } catch (error) {
    outcome.failure ??= failureKind(error);
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", abort);
    if (handle && !shutdown) {
      try {
        await runtime.close({
          handle,
          reason: "Worker attempt finished",
          discardPersistentState: true,
        });
      } catch (error) {
        if (
          isAcpRuntimeError(error) &&
          error.code === "ACP_BACKEND_UNSUPPORTED_CONTROL"
        ) {
          outcome.limitations.push(
            "Adapter session close is unsupported; owned processes were shut down and joined.",
          );
        } else outcome.failure ??= "cleanup";
      }
    }
    if (stopped) outcome.failure = stopped;
    if (!(await join())) outcome.failure = "cleanup";
    if (outcome.failure) outcome.status = "failed";
    records.clear();
  }
  return outcome;
}
