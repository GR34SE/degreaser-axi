import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { fixture } from "./git-fixture.ts";

const cli = fileURLToPath(
  new URL("../dist/bin/degreaser-axi.js", import.meta.url),
);
const loader = fileURLToPath(
  new URL("./fixtures/public-runtime.mjs", import.meta.url),
);
const targets = ["codex", "claude", "pi", "cursor"];
const faults = fileURLToPath(
  new URL("./fixtures/integration-fault.mjs", import.meta.url),
);
function setup(t: TestContext) {
  const f = fixture(t);
  const home = realpathSync(
    mkdtempSync(join(tmpdir(), "degreaser-integration-home-")),
  );
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const plan = join(home, "plan.json");
  writeFileSync(plan, JSON.stringify({ log: join(home, "events.jsonl") }));
  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: join(home, ".codex"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PI_CODING_AGENT_DIR: join(home, ".pi/agent"),
    SYNTHETIC_PLAN: plan,
  };
  const run = (args: string[]) =>
    spawnSync(process.execPath, ["--import", loader, cli, ...args], {
      cwd: f.root,
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
  const init = (harnesses: string, scope = "project") =>
    run([
      "init",
      "--agent",
      "codex",
      "--model",
      "gpt-6-luna",
      "--harnesses",
      harnesses,
      "--installation-scope",
      scope,
    ]);
  const maintenance = (harnesses: string, scope = "project", remove = false) =>
    run([
      "setup",
      "hooks",
      "--harnesses",
      harnesses,
      "--installation-scope",
      scope,
      ...(remove ? ["--remove"] : []),
    ]);
  return { ...f, home, env, run, init, maintenance };
}
function installed(base: string, scope: string) {
  return {
    codex: existsSync(join(base, ".codex/hooks.json")),
    claude: existsSync(join(base, ".claude/settings.json")),
    pi: existsSync(
      join(
        base,
        scope === "user"
          ? ".pi/agent/extensions/degreaser.ts"
          : ".pi/extensions/degreaser.ts",
      ),
    ),
    cursor: existsSync(join(base, ".cursor/hooks.json")),
    shared: existsSync(join(base, ".agents/skills/degreaser/SKILL.md")),
    claudeSkill: existsSync(join(base, ".claude/skills/degreaser/SKILL.md")),
  };
}

test("standalone setup protects its receipt and removal leaves unowned skills alone", (t) => {
  const f = setup(t);
  f.write(".gitignore", "ignored/\n");
  const index = readFileSync(join(f.root, ".git/index"));
  assert.equal(f.maintenance("claude").status, 0);
  assert.equal(
    f.git("check-ignore", ".degreaser/integrations.json").trim(),
    ".degreaser/integrations.json",
  );
  assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
  f.write(".agents/skills/degreaser/SKILL.md", "foreign");
  const before = snapshot(f.root);
  const removal = f.maintenance("codex", "project", true);
  assert.equal(removal.status, 0, removal.stdout);
  assert.deepEqual(snapshot(f.root), before);
});

test("init reports partial installation when the final RC write fails", (t) => {
  const f = setup(t);
  const original = readFileSync(join(f.root, ".degreaserrc.json"));
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      faults,
      "--import",
      loader,
      cli,
      "init",
      "--agent",
      "codex",
      "--model",
      "gpt-6-luna",
      "--harnesses",
      "claude",
    ],
    {
      cwd: f.root,
      env: { ...f.env, INTEGRATION_FAIL_RC: "1" },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /init-incomplete/);
  assert.match(result.stdout, /configuration: unchanged/);
  assert.match(result.stdout, /installed/);
  assert.deepEqual(readFileSync(join(f.root, ".degreaserrc.json")), original);
  assert.ok(installed(f.root, "project").claude);
});

test("an edit between integration writes is preserved and earlier writes are rolled back", (t) => {
  const f = setup(t);
  f.write(".claude/settings.json", '{"userEdit":false}\n');
  const result = spawnSync(
    process.execPath,
    ["--import", faults, cli, "setup", "hooks", "--harnesses", "claude"],
    {
      cwd: f.root,
      env: {
        ...f.env,
        INTEGRATION_EDIT_TARGET: join(f.root, ".claude/settings.json"),
      },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /conflict/);
  assert.deepEqual(
    JSON.parse(readFileSync(join(f.root, ".claude/settings.json"), "utf8")),
    { userEdit: true },
  );
  assert.ok(!installed(f.root, "project").claudeSkill);
  assert.ok(!existsSync(join(f.root, ".degreaser/integrations.json")));
});
function snapshot(root: string) {
  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const p = join(e.parentPath, e.name);
        return [p.slice(root.length), readFileSync(p).toString("base64")];
      }),
  );
}
for (const scope of ["project", "user"]) {
  for (let bits = 1; bits < 16; bits++) {
    const selected = targets.filter((_, i) => bits & (1 << i));
    test(`init installs only ${selected.join(",")} at ${scope} scope, repeat is duplicate-free`, (t) => {
      const f = setup(t);
      const index = readFileSync(join(f.root, ".git/index"));
      const result = f.init(selected.join(","), scope);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /installed/);
      assert.match(result.stdout, /reload|trust/i);
      assert.deepEqual(
        installed(scope === "project" ? f.root : f.home, scope),
        {
          codex: selected.includes("codex"),
          claude: selected.includes("claude"),
          pi: selected.includes("pi"),
          cursor: selected.includes("cursor"),
          shared:
            selected.includes("codex") ||
            selected.includes("pi") ||
            selected.includes("cursor"),
          claudeSkill: selected.includes("claude"),
        },
      );
      assert.deepEqual(
        installed(
          scope === "project" ? f.home : f.root,
          scope === "project" ? "user" : "project",
        ),
        {
          codex: false,
          claude: false,
          pi: false,
          cursor: false,
          shared: false,
          claudeSkill: false,
        },
      );
      const before = snapshot(f.root);
      const homeBefore = snapshot(f.home);
      assert.equal(f.init(selected.join(","), scope).status, 0);
      assert.deepEqual(snapshot(f.root), before);
      // Synthetic discovery appends its own log, outside product configuration.
      delete homeBefore["/events.jsonl"];
      const after = snapshot(f.home);
      delete after["/events.jsonl"];
      assert.deepEqual(after, homeBefore);
      assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
      for (const base of [f.root, f.home]) {
        assert.ok(!existsSync(join(base, ".codex/config.toml")));
        assert.ok(!existsSync(join(base, ".codex/rules")));
        assert.ok(!existsSync(join(base, "AGENTS.md")));
        assert.ok(!existsSync(join(base, "CLAUDE.md")));
      }
    });
  }
}

test("maintenance preserves foreign settings and other scope; shared skill survives a remaining owner", (t) => {
  const f = setup(t);
  const foreign = {
    env: { KEEP: "yes" },
    hooks: {
      SessionStart: [
        {
          matcher: "startup",
          hooks: [{ type: "command", command: "printf foreign" }],
        },
      ],
      Stop: [{ hooks: [{ type: "command", command: "true" }] }],
    },
  };
  f.write(".claude/settings.json", JSON.stringify(foreign));
  assert.equal(f.init("codex,claude,pi").status, 0);
  assert.equal(f.init("codex,claude,pi", "user").status, 0);
  const globalBefore = snapshot(f.home);
  const settings = JSON.parse(
    readFileSync(join(f.root, ".claude/settings.json"), "utf8"),
  );
  assert.equal(settings.hooks.SessionStart.length, 2);
  assert.deepEqual(settings.hooks.Stop, foreign.hooks.Stop);
  rmSync(join(f.root, ".pi/extensions/degreaser.ts"));
  assert.equal(f.maintenance("pi").status, 0);
  assert.ok(installed(f.root, "project").pi);
  assert.equal(f.maintenance("codex", "project", true).status, 0);
  assert.ok(installed(f.root, "project").shared);
  assert.equal(f.maintenance("claude,pi", "project", true).status, 0);
  assert.deepEqual(
    JSON.parse(readFileSync(join(f.root, ".claude/settings.json"), "utf8")),
    foreign,
  );
  assert.ok(!installed(f.root, "project").shared);
  assert.deepEqual(snapshot(f.home), globalBefore);
  assert.equal(f.maintenance("codex,claude,pi", "project", true).status, 0);
});

test("edited owned files and hook groups conflict without replacement or removal", (t) => {
  const f = setup(t);
  assert.equal(f.init("claude,pi").status, 0);
  for (const path of [
    ".agents/skills/degreaser/SKILL.md",
    ".pi/extensions/degreaser.ts",
    ".claude/settings.json",
  ]) {
    const full = join(f.root, path);
    const original = readFileSync(full, "utf8");
    if (path.endsWith(".json")) {
      const settings = JSON.parse(original);
      settings.hooks.SessionStart[0].hooks[0].command += " # hand edited";
      writeFileSync(full, JSON.stringify(settings));
    } else writeFileSync(full, `${original}\nUser edit\n`);
    const before = snapshot(f.root);
    for (const remove of [false, true]) {
      const result = f.maintenance("claude,pi", "project", remove);
      assert.equal(result.status, 2, result.stdout);
      assert.match(result.stdout, /conflict/);
      assert.deepEqual(snapshot(f.root), before);
    }
    writeFileSync(full, original);
  }
});

test("removing the ownership marker is a conflict, but a deleted owned hook can be repaired", (t) => {
  const f = setup(t);
  f.write(
    ".claude/settings.json",
    JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "printf foreign" }] },
        ],
      },
    }),
  );
  assert.equal(f.maintenance("claude").status, 0);
  const path = join(f.root, ".claude/settings.json");
  const installed = readFileSync(path, "utf8");
  const changed = JSON.parse(installed);
  changed.hooks.SessionStart[1].hooks[0].command = "printf user-edit";
  writeFileSync(path, JSON.stringify(changed));
  const edited = readFileSync(path);
  const refused = f.maintenance("claude");
  assert.equal(refused.status, 2, refused.stdout);
  assert.match(refused.stdout, /conflict/);
  assert.deepEqual(readFileSync(path), edited);
  changed.hooks.SessionStart.pop();
  writeFileSync(path, JSON.stringify(changed));
  assert.equal(f.maintenance("claude").status, 0);
  assert.equal(
    JSON.parse(readFileSync(path, "utf8")).hooks.SessionStart.length,
    2,
  );
});

test("foreign files, malformed native config and symlink ancestors are never overwritten", (t) => {
  const f = setup(t);
  for (const contents of ["{", '{"hooks":{"SessionStart":42}}']) {
    f.write(".claude/settings.json", contents);
    const before = snapshot(f.root);
    assert.equal(f.maintenance("claude").status, 2);
    assert.deepEqual(snapshot(f.root), before);
  }
  rmSync(join(f.root, ".claude"), { recursive: true });
  mkdirSync(join(f.home, "outside"));
  symlinkSync(join(f.home, "outside"), join(f.root, ".claude"));
  const result = f.maintenance("claude");
  assert.equal(result.status, 2, result.stdout);
  assert.deepEqual(readdirSync(join(f.home, "outside")), []);
  rmSync(join(f.root, ".claude"));
  f.write(".agents/skills/degreaser/SKILL.md", "Foreign skill");
  assert.equal(f.maintenance("codex").status, 2);
  assert.equal(
    readFileSync(join(f.root, ".agents/skills/degreaser/SKILL.md"), "utf8"),
    "Foreign skill",
  );
  assert.ok(!existsSync(join(f.root, ".codex/hooks.json")));
});

test("reinstall without the local receipt adopts identical files and the marked hook", (t) => {
  const f = setup(t);
  assert.equal(f.maintenance("codex,claude,pi,cursor").status, 0);
  // The rebuilt receipt may differ (an adopted hook file was not created by us).
  const files = () => {
    const { "/.degreaser/integrations.json": _receipt, ...rest } = snapshot(
      f.root,
    );
    return rest;
  };
  const installed = files();
  rmSync(join(f.root, ".degreaser/integrations.json"));
  const again = f.maintenance("codex,claude,pi,cursor");
  assert.equal(again.status, 0, again.stdout);
  assert.deepEqual(files(), installed);
  f.write(".agents/skills/degreaser/SKILL.md", "older Degreaser skill");
  rmSync(join(f.root, ".degreaser/integrations.json"));
  const stale = f.maintenance("codex");
  assert.equal(stale.status, 2, stale.stdout);
  assert.match(stale.stdout, /delete it and rerun/);
});

test("Claude's skill can link to the shared .agents copy and switch back to a copy", (t) => {
  const f = setup(t);
  const dir = join(f.root, ".claude/skills/degreaser");
  const linkArgs = [
    "setup",
    "hooks",
    "--harnesses",
    "codex,claude",
    "--skill-install",
    "link",
  ];
  assert.equal(f.maintenance("codex,claude").status, 0);
  assert.ok(lstatSync(dir).isDirectory());
  const linked = f.run(linkArgs);
  assert.equal(linked.status, 0, linked.stdout);
  assert.equal(readlinkSync(dir), "../../.agents/skills/degreaser");
  assert.equal(
    readFileSync(join(dir, "SKILL.md"), "utf8"),
    readFileSync(join(f.root, ".agents/skills/degreaser/SKILL.md"), "utf8"),
  );
  assert.equal(f.run(linkArgs).status, 0);
  const copied = f.maintenance("codex,claude");
  assert.equal(copied.status, 0, copied.stdout);
  assert.ok(lstatSync(dir).isDirectory());
  assert.ok(lstatSync(join(dir, "SKILL.md")).isFile());
  assert.equal(f.run(linkArgs).status, 0);
  assert.equal(f.maintenance("claude", "project", true).status, 0);
  assert.equal(existsSync(dir), false);
  assert.ok(existsSync(join(f.root, ".agents/skills/degreaser/SKILL.md")));
  const alone = f.run([
    "setup",
    "hooks",
    "--harnesses",
    "claude",
    "--skill-install",
    "link",
  ]);
  assert.equal(alone.status, 2, alone.stdout);
});

test("hooks use the bare command when PATH resolves to this install, including pnpm shims", (t) => {
  const bin = mkdtempSync(join(tmpdir(), "degreaser-path-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const command = (path: string) =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const m = await import(${JSON.stringify(new URL("../dist/src/integration-targets.js", import.meta.url).href)}); console.log(m.hookSpec.command);`,
      ],
      { encoding: "utf8", env: { ...process.env, PATH: path } },
    ).stdout;
  assert.match(command(bin), /node' '.*degreaser-axi\.js' startup-context/);
  writeFileSync(
    join(bin, "degreaser-axi"),
    `#!/bin/sh\nexec node "$0" "$@"\n# cmd-shim-target=${cli}\n`,
    { mode: 0o755 },
  );
  assert.match(command(bin), /then 'degreaser-axi' startup-context /);
  assert.match(command(`.:${bin.replace(/^\//, "")}`), /node' '/);
});
