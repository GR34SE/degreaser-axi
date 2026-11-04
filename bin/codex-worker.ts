#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { assertSubscriptionEnvironment } from "../src/native-environment.ts";
import { codexConfig } from "../src/native-profile.ts";

try {
  assertSubscriptionEnvironment(process.env);
  const require = createRequire(import.meta.url);
  const adapterRequire = createRequire(
    require.resolve("@agentclientprotocol/codex-acp"),
  );
  const native = adapterRequire.resolve("@openai/codex/bin/codex.js");
  const { features, ...config } = codexConfig;
  const args = [
    ...Object.entries(config),
    ...Object.entries(features).map(([key, value]) => [
      `features.${key}`,
      value,
    ]),
  ].flatMap(([key, value]) => ["-c", `${key}=${JSON.stringify(value)}`]);
  // Empty TOML tables merge with configured MCP servers. Ask the native config
  // consumer for their names, then disable each without rewriting any file.
  const servers: unknown = JSON.parse(
    execFileSync(process.execPath, [native, ...args, "mcp", "list", "--json"], {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1_048_576,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  if (!Array.isArray(servers))
    throw new Error("Unrecognized native MCP configuration.");
  const disabled: string[] = [];
  for (const server of servers) {
    if (
      !server ||
      typeof server.name !== "string" ||
      typeof server.enabled !== "boolean"
    )
      throw new Error("Unrecognized native MCP entry.");
    if (!server.enabled) continue;
    const transport =
      server.transport?.type === "stdio"
        ? 'command = "/usr/bin/false"'
        : server.transport?.type === "streamable_http"
          ? 'url = "https://invalid.invalid"'
          : undefined;
    if (!transport) throw new Error("Unrecognized native MCP transport.");
    // Synthesized native servers need a valid transport even when disabled.
    // Use inert values, never copy configured credentials into process argv.
    disabled.push(
      `${JSON.stringify(server.name)} = { enabled = false, ${transport} }`,
    );
  }
  args.push("-c", `mcp_servers={ ${disabled.join(", ")} }`);
  if (!process.execve)
    throw new Error("Native process replacement requires macOS and Node 24.");
  process.execve(
    process.execPath,
    [process.execPath, native, ...args, ...process.argv.slice(2)],
    process.env,
  );
} catch {
  console.error(
    "Codex worker profile could not launch. Check bundled native compatibility and subscription policy.",
  );
  process.exitCode = 1;
}
