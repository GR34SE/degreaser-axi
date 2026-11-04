// Synthetic ACP server uses the installed public protocol SDK; it does not
// implement review, validation, state, ownership or queue transitions.
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Readable, Writable } from "node:stream";

const require = createRequire(import.meta.url);
const sdk = createRequire(require.resolve("acpx/runtime"));
const { AgentSideConnection, ndJsonStream, RequestError } = await import(
  sdk.resolve("@agentclientprotocol/sdk")
);
const plan = JSON.parse(readFileSync(process.argv[2], "utf8"));
const model = process.env.SYNTHETIC_MODEL;
let current = model;
const configOptions = () => [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: current,
    options: [{ value: model, name: model }],
  },
];
const connection = new AgentSideConnection(
  () => ({
    async initialize() {
      return {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: {} },
        authMethods: [],
      };
    },
    async newSession() {
      return {
        sessionId: randomUUID(),
        configOptions: configOptions(),
        models: {
          currentModelId: current,
          availableModels: [{ modelId: model, name: model }],
        },
      };
    },
    async setSessionConfigOption(p) {
      current = p.value;
      return { configOptions: configOptions() };
    },
    async prompt(p) {
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
