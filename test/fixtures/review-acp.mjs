// Synthetic ACP server uses the installed public protocol SDK; it does not
// implement review, validation, state, ownership or queue transitions.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Readable, Writable } from "node:stream";
import { setTimeout } from "node:timers/promises";

const require = createRequire(import.meta.url);
const sdk = createRequire(require.resolve("acpx/runtime"));
const { AgentSideConnection, ndJsonStream, RequestError } = await import(
  sdk.resolve("@agentclientprotocol/sdk")
);
const plan = JSON.parse(readFileSync(process.argv[2], "utf8"));
const model = process.env.SYNTHETIC_MODEL;
const agent = process.env.SYNTHETIC_AGENT;
// Independent finite catalog, never derived from the requested model.
const catalog = {
  codex: ["gpt-6-luna", "exact-codex"],
  claude: ["claude-haiku-4-5-20251001"],
  pi: ["openai/gpt-6-luna"],
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
const models = (admitted && plan.runtimeModels) || catalog[agent];
const assessedPaths = () => {
  const { latestRunId } = JSON.parse(
    readFileSync(".degreaser/state.json", "utf8"),
  );
  const input = JSON.parse(
    readFileSync(`.degreaser/runs/${latestRunId}/input/review.json`, "utf8"),
  );
  return input.paths.map((p) => p.path);
};
const record = (event) => {
  if (plan.lifecycleLog)
    appendFileSync(
      plan.lifecycleLog,
      `${JSON.stringify({ agent, model, aspect: assigned, reviewing, pid: process.pid, time: Date.now(), ...event })}\n`,
    );
};
let current = model;
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
            settings.closeError || settings.closeHang ? { close: {} } : {},
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
      const aspect = /Assigned aspect: ([a-z-]+)/.exec(text)?.[1];
      const previous = existsSync(plan.log)
        ? readFileSync(plan.log, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map(JSON.parse)
        : [];
      const attempt = previous.filter(
        (event) => event.aspect === aspect,
      ).length;
      // Attempt overrides cover prompt faults; startup and close faults are session-wide.
      const step = settings.attempts?.[attempt] ?? settings;
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
      const planned = step.result ??
        plan.results?.[aspect] ?? {
          aspect,
          status: "no-findings",
          findings: [],
          limitations: [],
        };
      // A planned object without coverage declares the whole persisted scope;
      // coverage tests set examinedPaths explicitly.
      const result =
        typeof planned === "string"
          ? planned
          : { examinedPaths: assessedPaths(), ...planned };
      if (plan.toolOnly)
        await connection.sessionUpdate({
          sessionId: p.sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "synthetic",
            title: "Synthetic tool",
            kind: "read",
            status: "completed",
            content: [
              { type: "content", content: { type: "text", text: result } },
            ],
          },
        });
      else
        await connection.sessionUpdate({
          sessionId: p.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text:
                typeof result === "string"
                  ? result
                  : "<degreaser-result>" +
                    JSON.stringify(result) +
                    "</degreaser-result>",
            },
          },
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
    async closeSession() {
      record({ type: "close" });
      if (settings.closeHang) await new Promise(() => {});
      fault(settings.closeError);
      return {};
    },
    async cancel() {},
  }),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
);
await connection.closed;
record({ type: "disconnected" });
