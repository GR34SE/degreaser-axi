import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Agent } from "../src/config.ts";

/** Opt-in native metadata only. Never starts a model turn. */
export async function liveModels(agent: Agent, model: string) {
  const { discoverModels }: typeof import("../src/model-discovery.ts") =
    await import(
      new URL("../dist/src/model-discovery.js", import.meta.url).href
    );
  const cwd = await mkdtemp(join(tmpdir(), "degreaser-live-models-"));
  const piSettings = join(
    process.env.PI_CODING_AGENT_DIR ??
      join(process.env.HOME ?? "", ".pi/agent"),
    "settings.json",
  );
  const before =
    agent === "pi" ? await readFile(piSettings).catch(() => null) : null;
  try {
    const models = await discoverModels({ agent, model }, cwd, 30_000);
    assert.ok(
      models.availableModelIds.includes(model),
      "Selected exact identity is absent from native metadata.",
    );
    console.log(
      JSON.stringify({
        agent,
        model,
        catalogSize: models.availableModelIds.length,
        selectedListed: true,
        inference: false,
      }),
    );
    if (agent === "claude") {
      const incompatible = await discoverModels(
        { agent, model: "gpt-6-luna" },
        cwd,
        30_000,
      );
      assert.ok(
        !incompatible.availableModelIds.includes("gpt-6-luna"),
        "Requested model must not seed Claude's catalog.",
      );
      assert.equal(spawnSync("git", ["init"], { cwd }).status, 0);
      await writeFile(
        join(cwd, ".gitignore"),
        ".degreaserrc.json\n.degreaser/\n",
      );
      await writeFile(join(cwd, "source.ts"), "export const value = 1;\n");
      const cli = fileURLToPath(
        new URL("../dist/bin/degreaser-axi.js", import.meta.url),
      );
      for (const override of [false, true]) {
        await writeFile(
          join(cwd, ".degreaserrc.json"),
          JSON.stringify(
            override
              ? {
                  agent: "codex",
                  model: "gpt-6-luna",
                  aspects: {
                    overrides: {
                      A06: { agent: "claude", model: "gpt-6-luna" },
                    },
                  },
                }
              : { agent: "claude", model: "gpt-6-luna" },
          ),
        );
        const result = spawnSync(
          process.execPath,
          [
            cli,
            "review",
            "--scope",
            "worktree",
            "--task",
            "Synthetic metadata refusal",
            "--aspects",
            "A06",
          ],
          { cwd, encoding: "utf8", timeout: 45000 },
        );
        assert.equal(
          result.status,
          2,
          "Real incompatible pair must refuse before admission.",
        );
        assert.match(result.stdout, /error: invalid-input/);
        assert.match(result.stdout, /exact model list/);
        await assert.rejects(readFile(join(cwd, ".degreaser/state.json")), {
          code: "ENOENT",
        });
        console.log(
          JSON.stringify({
            agent,
            model: "gpt-6-luna",
            override,
            error: "invalid-input",
            exit: result.status,
            runCreated: false,
            inference: false,
          }),
        );
      }
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
    if (agent === "pi")
      assert.deepEqual(
        await readFile(piSettings).catch(() => null),
        before,
        "Pi defaults must remain unchanged.",
      );
  }
  console.log(
    JSON.stringify({
      agent,
      discoveryJoined: true,
      ...(agent === "pi" ? { settingsUnchanged: true } : {}),
    }),
  );
}
