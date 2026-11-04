#!/usr/bin/env node
import {
  launchNative,
  replaceOptions,
  selectedModel,
} from "../src/native-launch.ts";

try {
  const args = replaceOptions(process.argv.slice(2), {
    "--tools": "list",
    "--allowedTools": "list",
    "--allowed-tools": "list",
    "--disallowedTools": "list",
    "--disallowed-tools": "list",
    "--mcp-config": "list",
    "--settings": "value",
    "--setting-sources": "value",
    "--model": "value",
    "--fallback-model": "value",
    "--permission-mode": "value",
    "--strict-mcp-config": "switch",
    "--disable-slash-commands": "switch",
    "--safe-mode": "switch",
    "--dangerously-skip-permissions": "switch",
    "--allow-dangerously-skip-permissions": "switch",
    "--bare": "switch",
    "--plugin-dir": "list",
    "--agents": "value",
    "--agent": "value",
  });
  launchNative([
    ...args,
    "--model",
    selectedModel(),
    "--tools",
    "Read,Grep,Glob",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--settings",
    '{"disableAllHooks":true,"apiKeyHelper":""}',
    "--permission-mode",
    "default",
    "--disable-slash-commands",
    "--safe-mode",
  ]);
} catch {
  console.error(
    "Claude worker profile could not launch. Check native compatibility and subscription policy.",
  );
  process.exitCode = 1;
}
