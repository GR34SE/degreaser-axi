import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [installed, temporary] = process.argv.slice(2);
const { nativeProfile } = await import(
  pathToFileURL(join(installed, "dist/src/native-profile.js"))
);
const bin = join(temporary, "native-fixtures");
mkdirSync(bin, { recursive: true });
for (const [agent, version] of [
  ["claude", "2.1.317"],
  ["pi", "1.4.0"],
  ["cursor-agent", "2026.11.05-86047df"],
]) {
  writeFileSync(
    join(bin, agent),
    `#!${process.execPath}\nconsole.log(process.argv.includes('--version') ? ${JSON.stringify(version)} : JSON.stringify(process.argv.slice(2)));\n`,
    { mode: 0o755 },
  );
}
process.env.PATH = `${bin}:/usr/bin:/bin`;
for (const name of [
  "HOME",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "PI_CODING_AGENT_DIR",
]) {
  process.env[name] = join(temporary, "native-home", name);
  mkdirSync(process.env[name], { recursive: true });
}
for (const agent of ["codex", "claude", "pi", "cursor"]) {
  const profile = await nativeProfile({
    agent,
    model:
      agent === "pi"
        ? "openai/exact"
        : agent === "cursor"
          ? "composer-2.5-fast"
          : "exact",
  });
  assert.equal(profile.environment.DEGREASER_WORKER, "1");
  const wrapper = join(installed, "dist/bin", `${agent}-worker.js`);
  const result = spawnSync(
    process.execPath,
    [wrapper, ...(agent === "codex" ? ["--version"] : ["--mode", "rpc"])],
    {
      env: profile.environment,
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  if (agent === "codex") assert.match(result.stdout, /0\.165\.0/);
  else {
    const args = JSON.parse(result.stdout);
    assert.equal(args[args.indexOf("--model") + 1], profile.model);
    if (agent === "cursor") {
      assert.equal(args.at(-1), "acp");
      assert.equal(args[args.indexOf("--mode") + 1], "ask");
    } else {
      assert.equal(
        args[args.indexOf("--tools") + 1],
        agent === "claude" ? "Read,Grep,Glob" : "read,grep,find,ls",
      );
    }
  }
}
await assert.rejects(
  nativeProfile({ agent: "pi", model: "unqualified" }),
  /provider-qualified/,
);
writeFileSync(
  join(bin, "claude"),
  `#!${process.execPath}\nconsole.log('99.0.0');\n`,
  { mode: 0o755 },
);
await assert.rejects(
  nativeProfile({ agent: "claude", model: "exact" }),
  /Unsupported claude native version/,
);
console.log(
  "Installed native resolver and all compiled launchers passed; no model inference.",
);
