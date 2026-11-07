import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inspectIntegrations } from "../src/integration-diagnostics.ts";
import { prepareIntegrations } from "../src/integrations.ts";

test("inspection reports owned, missing, modified and unmanaged components without writing", () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "degreaser-inspect-"));
  const oldHome = process.env.HOME;
  const oldCodex = process.env.CODEX_HOME;
  const oldClaude = process.env.CLAUDE_CONFIG_DIR;
  const oldPi = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.HOME = root;
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_CONFIG_DIR;
    delete process.env.PI_CODING_AGENT_DIR;
    const repository = join(root, "project");
    prepareIntegrations(repository, ["claude", "pi"], "project").apply();
    prepareIntegrations(repository, ["codex"], "user").apply();
    const settingsPath = join(repository, ".claude/settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    settings.disableAllHooks = true;
    settings.hooks.SessionStart.push({
      hooks: [{ type: "command", command: "foreign" }],
    });
    writeFileSync(settingsPath, JSON.stringify(settings));
    const extension = join(repository, ".pi/extensions/degreaser.ts");
    writeFileSync(extension, "changed");
    const before = readFileSync(settingsPath, "utf8");
    const entries = inspectIntegrations(repository);
    const claude = entries.find(
      (entry) => entry.harness === "claude" && entry.scope === "project",
    );
    assert.ok(claude);
    assert.equal(claude.status, "installed");
    assert.equal(claude.hook?.status, "installed");
    assert.equal(claude.disableAllHooks, true);
    assert.match(claude.activation, /trust|policy/i);
    const pi = entries.find(
      (entry) => entry.harness === "pi" && entry.scope === "project",
    );
    assert.ok(pi);
    assert.equal(pi.status, "modified");
    assert.equal(
      pi.files.find((file) => file.path === extension)?.status,
      "modified",
    );
    assert.equal(
      entries.find(
        (entry) => entry.harness === "codex" && entry.scope === "user",
      )?.status,
      "installed",
    );
    assert.equal(
      entries.find(
        (entry) => entry.harness === "claude" && entry.scope === "user",
      )?.status,
      "missing",
    );
    assert.equal(readFileSync(settingsPath, "utf8"), before);

    const hook = settings.hooks.SessionStart[0];
    settings.hooks.SessionStart = [settings.hooks.SessionStart[1]];
    writeFileSync(settingsPath, JSON.stringify(settings));
    assert.equal(
      inspectIntegrations(repository).find(
        (entry) => entry.harness === "claude" && entry.scope === "project",
      )?.hook?.status,
      "missing",
    );
    settings.hooks.SessionStart.push(hook);
    hook.hooks[0].command += " modified";
    writeFileSync(settingsPath, JSON.stringify(settings));
    assert.equal(
      inspectIntegrations(repository).find(
        (entry) => entry.harness === "claude" && entry.scope === "project",
      )?.hook?.status,
      "modified",
    );
  } finally {
    for (const [key, value] of Object.entries({
      HOME: oldHome,
      CODEX_HOME: oldCodex,
      CLAUDE_CONFIG_DIR: oldClaude,
      PI_CODING_AGENT_DIR: oldPi,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("configured roots and invalid receipts do not produce false ownership", () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "degreaser-inspect-"));
  const oldHome = process.env.HOME;
  const oldClaude = process.env.CLAUDE_CONFIG_DIR;
  const oldCodex = process.env.CODEX_HOME;
  const oldPi = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.HOME = root;
    process.env.CLAUDE_CONFIG_DIR = join(root, "custom");
    delete process.env.CODEX_HOME;
    delete process.env.PI_CODING_AGENT_DIR;
    const repository = join(root, "project");
    prepareIntegrations(repository, ["claude"], "user").apply();
    let claude = inspectIntegrations(repository).find(
      (entry) => entry.harness === "claude" && entry.scope === "user",
    );
    assert.ok(claude);
    assert.equal(claude.status, "installed");
    assert.equal(claude.hook?.path, join(root, "custom/settings.json"));
    const receipt = join(root, ".degreaser/integrations.json");
    rmSync(receipt);
    claude = inspectIntegrations(repository).find(
      (entry) => entry.harness === "claude" && entry.scope === "user",
    );
    assert.ok(claude);
    assert.equal(claude.status, "unmanaged");
    assert.equal(claude.hook?.status, "unmanaged");
    writeFileSync(receipt, "{}");
    claude = inspectIntegrations(repository).find(
      (entry) => entry.harness === "claude" && entry.scope === "user",
    );
    assert.ok(claude);
    assert.equal(claude.status, "unverified");
    assert.equal(claude.receipt, "invalid");
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = oldClaude;
    if (oldCodex === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = oldCodex;
    if (oldPi === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldPi;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a linked Claude skill outlives codex removal and inspects as installed", (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "degreaser-link-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const shared = join(root, ".agents/skills/degreaser/SKILL.md");
  const linked = join(root, ".claude/skills/degreaser/SKILL.md");
  prepareIntegrations(root, ["codex", "claude"], "project", {
    skillInstall: "link",
  }).apply();
  prepareIntegrations(root, ["codex"], "project", { remove: true }).apply();
  assert.equal(readFileSync(linked, "utf8"), readFileSync(shared, "utf8"));
  const claude = inspectIntegrations(root).find(
    (r) => r.harness === "claude" && r.scope === "project",
  );
  assert.equal(claude?.files[0]?.status, "installed");
  prepareIntegrations(root, ["claude"], "project", { remove: true }).apply();
  assert.equal(existsSync(shared), false);
});
