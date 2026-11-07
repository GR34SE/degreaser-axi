import { randomUUID } from "node:crypto";
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
import { workerInstruction } from "./prompt.ts";
import { type WorkerFailure, workerFailure } from "./worker-failure.ts";

export interface WorkerRequest {
  cwd: string;
  /** Assembled assignment, task/scope and response contract. Never ambient caller history. */
  prompt: string;
  maxTurns: number;
  timeoutMs: number;
  /** Stop the attempt after this long without any adapter event. */
  idleMs?: number;
  onActivity?: () => void;
  signal?: AbortSignal;
  onPromptStarted?: () => void;
  onSessionReady?: (id: string) => void;
  onLifecycle?: (event: { type: "spawn" | "exit"; pid: number }) => void;
  onTool?: (event: { kind: string; status: string }) => void;
}
export interface WorkerOutcome {
  status: "completed" | "failed";
  model: string;
  sessionId?: string;
  output: string;
  failure?: WorkerFailure;
  cleanupFailed: boolean;
  usage: AcpRuntimeUsageBreakdown | null;
  limitations: string[];
}

/** Harness-wide, not aspect-specific: reports show it once at run level. */
export function turnBudgetLimitations(agent: string, maxTurns: number) {
  return agent === "claude"
    ? []
    : [
        `${agent} does not natively enforce maxTurns (${maxTurns}); the instruction budget is advisory. Attempt and run deadlines are enforced.`,
      ];
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
    cleanupFailed: false,
    limitations: [
      ...profile.limitations,
      ...turnBudgetLimitations(profile.agent, request.maxTurns),
    ],
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
  let idle: NodeJS.Timeout | undefined;
  const active = () => {
    request.onActivity?.();
    const { idleMs } = request;
    if (!idleMs) return;
    clearTimeout(idle);
    idle = setTimeout(() => {
      outcome.limitations.push(
        `No worker activity for ${idleMs / 1000} seconds; the attempt was stopped as idle.`,
      );
      stop("timeout");
    }, request.idleMs);
  };
  let handle: AcpRuntimeHandle | undefined;
  try {
    if (request.signal?.aborted) stop("cancelled");
    // Only Claude honors a system prompt (acpx replaces Claude Code's own), so
    // it carries the shared instruction there and not again in the turn text.
    // Other harnesses read it as the first section of the turn text.
    const instruction = workerInstruction(request.maxTurns);
    const system =
      profile.agent === "claude" && request.prompt.startsWith(instruction);
    const prompt = system
      ? request.prompt.slice(instruction.length).trimStart()
      : request.prompt;
    handle = await runtime.ensureSession({
      sessionKey: `degreaser-${randomUUID()}`,
      agent: profile.agent,
      mode: "persistent",
      cwd: request.cwd,
      sessionOptions: {
        maxTurns: request.maxTurns,
        ...(system ? { systemPrompt: instruction } : {}),
        ...(profile.agent === "claude"
          ? { allowedTools: ["Read", "Grep", "Glob"] }
          : {}),
      },
    });
    const sessionId = handle.agentSessionId ?? handle.backendSessionId;
    if (sessionId) {
      outcome.sessionId = sessionId;
      request.onSessionReady?.(sessionId);
    }
    const advertised = await runtime.getStatus({ handle });
    if (!advertised.models?.availableModelIds.includes(profile.model)) {
      outcome.failure = "model-unavailable";
      return outcome;
    }
    if (profile.agent === "cursor") {
      try {
        await runtime.setMode({ handle, mode: "ask" });
      } catch {
        outcome.limitations.push(
          "Cursor session mode was not confirmed; argv requests ask mode and writes are denied.",
        );
      }
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
      text: prompt,
      timeoutMs: request.timeoutMs,
      assertActive() {
        if (stopped) throw new Error("Worker admission cancelled.");
      },
    });
    await turn.promptStarted;
    request.onPromptStarted?.();
    active();
    for await (const event of turn.events) {
      active();
      if (event.type === "text_delta" && event.stream !== "thought") {
        if (outcome.output.length + event.text.length > 1_048_576) {
          outcome.output = "";
          outcome.failure = "output-limit";
          outcome.limitations.push(
            "Worker output exceeded 1,048,576 characters and was discarded; no result was accepted.",
          );
          await turn.cancel();
          break;
        }
        outcome.output += event.text;
      }
      if (event.type === "tool_call")
        request.onTool?.({
          kind: event.kind ?? "other",
          status: event.status ?? "unknown",
        });
    }
    // The stream ended; result and status calls are not worker inactivity.
    clearTimeout(idle);
    const result = await turn.result;
    if (!outcome.failure) {
      if (result.status === "completed") outcome.status = "completed";
      else {
        const failure =
          result.status === "cancelled"
            ? "cancelled"
            : workerFailure(result.error);
        outcome.failure =
          failure === "runtime" ? (stopped ?? failure) : failure;
      }
    }
    const status = await runtime.getStatus({ handle });
    outcome.usage = status.usage?.cumulative ?? null;
  } catch (error) {
    const failure = workerFailure(error);
    outcome.failure ??= failure === "runtime" ? (stopped ?? failure) : failure;
  } finally {
    clearTimeout(timer);
    clearTimeout(idle);
    let unsupportedClose = false;
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
          unsupportedClose = true;
        } else if (!stopped) outcome.cleanupFailed = true;
      }
    }
    if (!(await join())) outcome.cleanupFailed = true;
    if (stopped && (!outcome.failure || outcome.failure === "cancelled"))
      outcome.failure = stopped;
    if (unsupportedClose && !outcome.cleanupFailed)
      outcome.limitations.push(
        "Adapter session close is unsupported; owned processes were shut down and joined.",
      );
    if (outcome.cleanupFailed) {
      outcome.failure ??= "cleanup";
      outcome.limitations.push(
        "Worker cleanup failed. Any validated evidence is retained as incomplete, not clean completion.",
      );
    }
    request.signal?.removeEventListener("abort", abort);
    if (outcome.failure) outcome.status = "failed";
    records.clear();
  }
  return outcome;
}
