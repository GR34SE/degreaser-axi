// Synthetic native Pi RPC consumer. The official adapter and product launcher
// remain real; this finite catalog is independent of the requested identity.
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

const directory = dirname(process.argv[1]);
const plan = JSON.parse(readFileSync(join(directory, "plan.json"), "utf8"));
const record = (event) =>
  appendFileSync(
    join(directory, "events.jsonl"),
    `${JSON.stringify({ pid: process.pid, ...event })}\n`,
  );
const args = process.argv.slice(2);
record({ type: "launch", args });
if (args.includes("--version")) {
  console.log(plan.wrongVersion ? "99.0.0" : "1.4.0");
  process.exit(0);
}
const catalog = [{ provider: "openai", id: "gpt-6-luna", name: "Luna" }];
const modelIndex = args.indexOf("--model");
if (
  modelIndex !== -1 &&
  !catalog.some((m) => `${m.provider}/${m.id}` === args[modelIndex + 1])
) {
  // Reproduce native startup refusal before metadata can be served.
  process.exit(1);
}
const current =
  plan.runtimeModelMismatch && modelIndex !== -1
    ? { provider: "anthropic", id: "claude-haiku-4-5-20251001" }
    : catalog[0];
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  record({ type: request.type });
  const data =
    request.type === "get_state"
      ? { model: current, thinkingLevel: "medium" }
      : request.type === "get_available_models"
        ? { models: plan.unauthenticated ? [] : catalog }
        : { commands: [] };
  const success =
    ["get_state", "get_available_models", "get_commands"].includes(
      request.type,
    ) && !(plan.metadataFailure && request.type === "get_available_models");
  console.log(
    JSON.stringify({
      type: "response",
      id: request.id,
      command: request.type,
      success,
      ...(success ? { data } : { error: "Synthetic private diagnostic" }),
    }),
  );
}
