import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "../../../../test/utils/git-fixture.ts";
import { inspectIntegrations } from "../../../install/inspect.ts";
import { prepareIntegrations } from "../../../install/plan.ts";
import { createFactory } from "../../factory.ts";
import { parseCommand } from "../../parse.ts";
import * as hooks from "../setup/hooks/hooks.ts";
import { run } from "./doctor.ts";

for (const receipted of [true, false]) {
  test(`doctor identifies an old absolute checkout hook ${receipted ? "with" : "without"} its receipt and recommends selected repair`, async (t) => {
    const f = fixture(t);
    const home = join(f.root, "ignored/home");
    f.write("ignored/home/keep", "");
    const runtime = createFactory({
      cwd: f.root,
      home,
      env: { HOME: home, PATH: "/usr/bin:/bin" },
      spawn: () => {
        throw new Error("Doctor must not start a model.");
      },
    });
    prepareIntegrations(runtime, f.root, ["claude"], "project").apply();
    const path = join(f.root, ".claude/settings.json");
    const settings = JSON.parse(readFileSync(path, "utf8"));
    settings.hooks.SessionStart[0].hooks[0].command =
      settings.hooks.SessionStart[0].hooks[0].command.replace(
        /then .+ startup-context/,
        "then '/old node' '/old checkout/dist/bin/degreaser-axi.js' startup-context",
      );
    f.write(".claude/settings.json", JSON.stringify(settings));
    const receiptPath = join(f.root, ".degreaser/integrations.json");
    if (receipted) {
      const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
      receipt.hooks.claude.group = settings.hooks.SessionStart[0];
      f.write(".degreaser/integrations.json", JSON.stringify(receipt));
    } else rmSync(receiptPath);
    const before = readFileSync(path);
    const result = await run(runtime);
    const entry = result.output.integrations.find(
      (entry) => entry.harness === "claude" && entry.scope === "project",
    );
    assert.equal(entry?.hook?.legacyCheckout, true);
    assert.ok(
      result.output.help.includes(
        "degreaser-axi setup hooks --harnesses claude",
      ),
    );
    assert.deepEqual(readFileSync(path), before, "doctor is read-only");
    hooks.run(
      runtime,
      parseCommand("setup hooks", hooks.spec, ["--harnesses", "claude"]),
    );
    const repaired = inspectIntegrations(runtime, f.root).find(
      (entry) => entry.harness === "claude" && entry.scope === "project",
    );
    assert.equal(repaired?.hook?.status, "installed");
    assert.equal(repaired?.hook?.legacyCheckout, undefined);
    assert.ok(!readFileSync(path, "utf8").includes("/dist/bin/"));
  });
}
