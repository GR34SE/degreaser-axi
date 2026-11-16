import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Readable, Writable } from "node:stream";
import { setTimeout } from "node:timers/promises";
import { sendResult } from "./review-result.mjs";

const require = createRequire(import.meta.url);
const sdk = createRequire(require.resolve("acpx/runtime"));
const { AgentSideConnection, ndJsonStream, RequestError } = await import(
  sdk.resolve("@agentclientprotocol/sdk")
);
const { decode } = await import(require.resolve("@toon-format/toon"));
const plan = JSON.parse(readFileSync(process.argv[2], "utf8"));
const model = process.env.SYNTHETIC_MODEL;
const agent = process.env.SYNTHETIC_AGENT;
const catalog = {
  codex: ["exact-codex", "gpt-6-luna", "gpt-6-terra", "gpt-6-sol"],
  claude: ["claude-haiku-4-5-20251001"],
  pi: ["openai/gpt-6-luna", "openai/gpt-6-terra", "openai/gpt-6-sol"],
  cursor: ["composer-2.5-fast"],
};
const admitted = existsSync(".degreaser/state.json");
const reviewing = process.env.SYNTHETIC_PURPOSE === "review";
const assigned = process.env.SYNTHETIC_ASPECT;
const settings = reviewing
  ? (plan.workers?.[assigned] ?? plan.worker ?? {})
  : {};
const gate = async (path) => {
  if (!path) return;
  while (!existsSync(path)) await setTimeout(20);
};
const fault = (error) => {
  if (error)
    throw new RequestError(error.code ?? -32000, error.message, error.data);
};
const models =
  (admitted && plan.runtimeModels) || plan.models?.[agent] || catalog[agent];
const record = (event) => {
  if (plan.lifecycleLog)
    appendFileSync(
      plan.lifecycleLog,
      `${JSON.stringify({ agent, model, aspect: assigned, reviewing, pid: process.pid, time: Date.now(), ...event })}\n`,
    );
};
let current = model;
const sessions = new Map();
const configOptions = () => [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: current,
    options: models.map((value) => ({ value, name: value })),
  },
];
const connection = new AgentSideConnection(
  () => ({
    async initialize(params) {
      record({
        type: "initialize",
        workerMarker: process.env.DEGREASER_WORKER,
        initialMode: process.env.INITIAL_AGENT_MODE,
        codexConfig: process.env.CODEX_CONFIG
          ? JSON.parse(process.env.CODEX_CONFIG)
          : null,
        capabilities: params.clientCapabilities,
        inheritedAuth: Object.keys(process.env).filter((key) =>
          /^(ACPX_AUTH_|OPENAI_API_KEY)/.test(key),
        ),
      });
      await gate(settings.initializeGate);
      if (settings.startupHang) await new Promise(() => {});
      fault(settings.startupError);
      return {
        protocolVersion: 1,
        agentCapabilities: {
          sessionCapabilities:
            settings.closeError ||
            settings.finderCloseError ||
            settings.closeHang
              ? { close: {} }
              : {},
        },
        authMethods: [],
      };
    },
    async newSession(params) {
      record({ type: "session", admitted, meta: params._meta });
      if (!reviewing) fault(plan.metadataError);
      if (plan.metadataFailure || plan.metadataFailureAgents?.includes(agent))
        throw new RequestError(
          -32000,
          "Synthetic metadata failure, private diagnostic must not leak",
        );
      if (plan.metadataHang) await new Promise(() => {});
      return {
        sessionId: randomUUID(),
        ...(plan.noMetadata
          ? {}
          : {
              configOptions: configOptions(),
              models: {
                currentModelId: current,
                availableModels: models.map((modelId) => ({
                  modelId,
                  name: modelId,
                })),
              },
            }),
      };
    },
    async setSessionConfigOption(p) {
      record({ type: "set-model", value: p.value });
      await gate(settings.invocationGate);
      current = p.value;
      return { configOptions: configOptions() };
    },
    async prompt(p) {
      record({ type: "prompt" });
      const text = p.prompt
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      const opened = /Assigned aspect: ([a-z-]+)/.exec(text)?.[1];
      const known = sessions.get(p.sessionId);
      const round = opened || !known ? 0 : known.round + 1;
      const aspect = opened ?? known?.aspect;
      // On Linux a concurrent reader can see another worker's append
      // half-written; only newline-terminated records are complete.
      const logged = existsSync(plan.log) ? readFileSync(plan.log, "utf8") : "";
      const previous = logged
        .slice(0, logged.lastIndexOf("\n") + 1)
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
      const stage = round
        ? known.stage
        : /^# Verifier (instruction|response contract)/.test(text)
          ? "verify"
          : "find";
      const fence = /<(degreaser-input-[0-9a-f]+)>\n([\s\S]*?)\n<\/\1>/.exec(
        text,
      );
      const input = fence ? decode(fence[2]) : {};
      const paths = (input.paths ?? []).map((p) => p.path);
      const candidates = input.candidates ?? [];
      const attempt = round
        ? known.attempt
        : previous.filter(
            (event) =>
              event.aspect === aspect && event.stage === stage && !event.round,
          ).length;
      sessions.set(p.sessionId, { aspect, stage, round, attempt });
      const staged = stage === "verify" ? (settings.verifier ?? {}) : settings;
      const attempted = staged.attempts?.[attempt] ?? staged;
      const step = attempted.rounds?.[round] ?? attempted;
      if (plan.nestedCli) {
        const { latestRunId } = JSON.parse(
          readFileSync(".degreaser/state.json", "utf8"),
        );
        for (const args of [
          ["review", "--scope", "worktree", "--task", "Nested review"],
          ["resume", latestRunId],
        ]) {
          const result = spawnSync(
            process.execPath,
            [plan.nestedCli, ...args],
            {
              encoding: "utf8",
              timeout: 10000,
            },
          );
          record({
            type: "nested",
            command: args[0],
            code: result.status,
            stdout: result.stdout,
          });
        }
      }
      appendFileSync(
        plan.log,
        `${JSON.stringify({
          aspect,
          stage,
          paths,
          ...(round ? { round } : {}),
          ...(stage === "verify" ? { candidates } : {}),
          model,
          prompt: text,
          sessionId: p.sessionId,
          pid: process.pid,
          agent,
          time: Date.now(),
        })}\n`,
      );
      await gate(step.resultGate);
      if (step.descendant) {
        const child = spawn(
          process.execPath,
          ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
          { stdio: "ignore" },
        );
        record({ type: "descendant", childPid: child.pid });
      }
      if (step.hang) await new Promise(() => {});
      if (step.permissionRequest) {
        const response = await connection.requestPermission({
          sessionId: p.sessionId,
          toolCall: {
            toolCallId: "synthetic-write",
            title: "Write source",
            kind: "edit",
            status: "pending",
          },
          options: [
            { optionId: "allow", kind: "allow_once", name: "Allow" },
            { optionId: "deny", kind: "reject_once", name: "Deny" },
          ],
        });
        record({ type: "permission", outcome: response.outcome });
      }
      fault(step.error);
      if (step.diagnosticText) {
        process.stderr.write(step.diagnosticText);
        for (const sessionUpdate of ["agent_thought_chunk", "tool_call"]) {
          await connection.sessionUpdate({
            sessionId: p.sessionId,
            update:
              sessionUpdate === "tool_call"
                ? {
                    sessionUpdate,
                    toolCallId: "privacy-canary",
                    title: "Read",
                    kind: "read",
                    status: "completed",
                    content: [
                      {
                        type: "content",
                        content: { type: "text", text: step.diagnosticText },
                      },
                    ],
                  }
                : {
                    sessionUpdate,
                    content: { type: "text", text: step.diagnosticText },
                  },
          });
        }
      }
      if (plan.delayMs) await setTimeout(plan.delayMs);
      if (plan.permissionDeniedBefore)
        throw new RequestError(
          -32000,
          "Synthetic permission denied before result",
        );
      await sendResult(connection, p.sessionId, plan, step, aspect, {
        stage,
        candidates: candidates.length,
        paths,
      });
      record({ type: "output" });
      if (plan.permissionDenied)
        throw new RequestError(
          -32000,
          "Synthetic permission denied after usable result",
        );
      fault(step.afterError);
      if (step.afterHang) await new Promise(() => {});
      record({ type: "result" });
      return {
        stopReason: "end_turn",
        ...(step.usage ? { usage: step.usage } : {}),
      };
    },
    async closeSession(params) {
      record({ type: "close" });
      if (settings.closeHang) await new Promise(() => {});
      fault(
        settings.closeError ??
          (sessions.get(params.sessionId)?.stage === "find"
            ? settings.finderCloseError
            : undefined),
      );
      return {};
    },
    async cancel() {},
  }),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
);
await connection.closed;
record({ type: "disconnected" });
