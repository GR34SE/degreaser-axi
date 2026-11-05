#!/usr/bin/env node
import {
  launchNative,
  replaceOptions,
  selectedModel,
} from "../src/native-launch.ts";

try {
  const discovery = process.env.DEGREASER_MODEL_DISCOVERY === "1";
  const model = discovery ? "" : selectedModel();
  if (!discovery && !/^[^/]+\/[^/]+$/.test(model))
    throw new Error("Provider-qualified model required.");
  const args = replaceOptions(process.argv.slice(2), {
    "--model": "value",
    "-m": "value",
    "--provider": "value",
    "--tools": "value",
    "--skill": "value",
    "--extension": "value",
    "-e": "value",
    "--prompt-template": "value",
    "--mcp": "value",
  });
  launchNative([
    ...args,
    ...(discovery ? [] : ["--model", model]),
    "--tools",
    "read,grep,find,ls",
    "--no-skills",
    "--no-extensions",
    "--no-mcp",
    "--no-context-files",
    "--no-prompt-templates",
    "--offline",
  ]);
} catch {
  console.error(
    "Pi worker profile could not launch. Check native compatibility and subscription policy.",
  );
  process.exitCode = 1;
}
