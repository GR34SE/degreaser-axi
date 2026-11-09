import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Readable, Writable } from "node:stream";

const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve("acpx/runtime"));
const { AgentSideConnection, ndJsonStream, RequestError } = await import(
  sdkRequire.resolve("@agentclientprotocol/sdk")
);
const [scenario, log] = process.argv.slice(2);
const record = (event) => appendFileSync(log, `${JSON.stringify(event)}\n`);
const selected = scenario === "pi" ? "openai/exact" : "exact";
let current = scenario === "pi" ? selected : "default";
let cancelled;
let child;
const configOptions = () => [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: current,
    options: [
      { value: selected, name: "Selected" },
      { value: "default", name: "Default" },
    ],
  },
];
const connection = new AgentSideConnection(
  () => ({
    async initialize(params) {
      record({
        method: "initialize",
        fs: params.clientCapabilities?.fs,
        terminal: params.clientCapabilities?.terminal,
        marker: process.env.DEGREASER_WORKER,
        leaked: Object.keys(process.env).filter((k) =>
          /ACPX_AUTH_|API_KEY|NODE_OPTIONS/.test(k),
        ),
      });
      if (scenario === "startup-hang") await new Promise(() => {});
      return {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: {} },
        authMethods: [],
      };
    },
    async newSession(params) {
      if (scenario === "session-fail")
        throw new RequestError(
          -32000,
          "Synthetic setup failure synthetic-secret",
        );
      const sessionId = randomUUID();
      record({
        method: "new",
        sessionId,
        system: params?._meta?.systemPrompt ?? null,
      });
      return {
        sessionId,
        configOptions: configOptions(),
        models: {
          currentModelId: current,
          availableModels: [
            { modelId: selected, name: "Selected" },
            { modelId: "default", name: "Default" },
          ],
        },
      };
    },
    async setSessionConfigOption(params) {
      record({ method: "setModel", model: params.value });
      if (scenario !== "mismatch") current = params.value;
      return { configOptions: configOptions() };
    },
    async prompt(params) {
      record({
        method: "prompt",
        model: current,
        text: params.prompt?.map((part) => part.text ?? "").join(""),
      });
      if (scenario === "rate-limit")
        throw new RequestError(
          -32000,
          "Synthetic rate limit 429 synthetic-secret",
        );
      if (scenario === "refusal") return { stopReason: "refusal" };
      if (scenario === "hang") {
        child = spawn(
          process.execPath,
          ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
          { stdio: "ignore" },
        );
        record({ method: "child", pid: child.pid });
        await new Promise((resolve) => {
          cancelled = resolve;
        });
        return { stopReason: "cancelled" };
      }
      if (scenario === "output-limit") {
        for (let i = 0; i < 17; i++)
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "x".repeat(65_536) },
            },
          });
        await new Promise((resolve) => {
          cancelled = resolve;
        });
        return { stopReason: "cancelled" };
      }
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "private synthetic thought" },
        },
      });
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: '<degreaser-result>{"aspect":"low-value-comments","status":"no-findings","findings":[],"limitations":[]}</degreaser-result>',
          },
        },
      });
      return { stopReason: "end_turn" };
    },
    async cancel() {
      record({ method: "cancel" });
      cancelled?.();
    },
  }),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
);
await connection.closed;
child?.kill("SIGTERM");
