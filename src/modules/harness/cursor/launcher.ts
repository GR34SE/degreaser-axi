#!/usr/bin/env node
import {
  launchNative,
  replaceOptions,
  selectedModel,
} from "../common/launch.ts";

try {
  const discovery = process.env.DEGREASER_MODEL_DISCOVERY === "1";
  const args = replaceOptions(process.argv.slice(2), {
    "--mode": "value",
    "--plan": "switch",
    "--model": "value",
    "--force": "switch",
    "-f": "switch",
    "--yolo": "switch",
    "--auto-review": "switch",
    "--sandbox": "value",
    "--approve-mcps": "switch",
    "--plugin-dir": "list",
    "--api-key": "value",
    "--header": "list",
    "-H": "list",
    "--endpoint": "value",
    "-e": "value",
    "--print": "switch",
    "-p": "switch",
    "--output-format": "value",
    "--stream-partial-output": "switch",
    "--resume": "value",
    "--continue": "switch",
    "--worktree": "value",
    "-w": "value",
    "--worktree-base": "value",
    "--skip-worktree-setup": "switch",
    "--add-dir": "list",
    "--workspace": "value",
    "--trust": "switch",
  }).filter((arg) => arg !== "acp");
  launchNative(
    [
      ...args,
      ...(discovery ? [] : ["--model", selectedModel(process.env)]),
      "--mode",
      "ask",
      "--sandbox",
      "enabled",
      "--trust",
      "acp",
    ],
    process.env,
  );
} catch {
  process.stderr.write(
    "Cursor worker profile could not launch. Check native compatibility and subscription policy.".concat(
      "\n",
    ),
    () => process.exit(1),
  );
}
