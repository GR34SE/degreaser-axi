// Synthetic ACP server uses the installed public protocol SDK; it does not
// implement review, validation, state, ownership or queue transitions.
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Readable, Writable } from "node:stream";

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
};
const admitted = existsSync(".degreaser/state.json");
const models = (admitted && plan.runtimeModels) || catalog[agent];
const record = (event) => {
  if (plan.lifecycleLog)
    appendFileSync(
      plan.lifecycleLog,
      `${JSON.stringify({ agent, model, pid: process.pid, ...event })}\n`,
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
        capabilities: params.clientCapabilities,
        inheritedAuth: Object.keys(process.env).filter((key) =>
          /^(ACPX_AUTH_|OPENAI_API_KEY)/.test(key),
        ),
      });
      return {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: {} },
        authMethods: [],
      };
    },
    async newSession() {
      record({ type: "session", admitted });
      if (plan.metadataFailure)
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
      current = p.value;
      return { configOptions: configOptions() };
    },
    async prompt(p) {
      record({ type: "prompt" });
      const text = p.prompt
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      const aspect = /Assigned aspect: (A\d\d)/.exec(text)?.[1];
      appendFileSync(
        plan.log,
        `${JSON.stringify({
          aspect,
          model,
          prompt: text,
          sessionId: p.sessionId,
          pid: process.pid,
        })}\n`,
      );
      if (plan.delayMs) await new Promise((r) => setTimeout(r, plan.delayMs));
      if (plan.permissionDeniedBefore)
        throw new RequestError(
          -32000,
          "Synthetic permission denied before result",
        );
      const result = plan.results?.[aspect] ?? {
        aspect,
        status: "no-findings",
        findings: [],
        limitations: [],
      };
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
      if (plan.permissionDenied)
        throw new RequestError(
          -32000,
          "Synthetic permission denied after usable result",
        );
      return { stopReason: "end_turn" };
    },
    async cancel() {},
  }),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
);
await connection.closed;
