import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { decode } from "@toon-format/toon";
import { createFactory } from "./factory.ts";
import { main } from "./router.ts";

test("injected CLI rejects invalid review and namespace arguments before dependencies or writes, even with help", async () => {
  const oldCode = process.exitCode;
  try {
    for (const argv of [
      ["review", "--scpoe", "worktree"],
      ["review", "--scope", "worktree"],
      ["review", "--scope", "worktree", "--task", "Update", "--task", "Again"],
      ["setup", "other", "--help"],
      ["config", "other", "--help"],
    ]) {
      let stdout = "",
        stderr = "",
        dependencies = 0;
      const unexpected = () => {
        dependencies++;
        throw new Error("Unexpected dependency.");
      };
      const f = createFactory({
        cwd: "/not-a-repository",
        env: {},
        config: unexpected,
        spawn: unexpected,
        spawnSync: unexpected,
        io: {
          input: Readable.from([]),
          interactive: false,
          output: new Writable({
            write(chunk, _encoding, done) {
              stdout += chunk;
              done();
            },
          }),
          error: new Writable({
            write(chunk, _encoding, done) {
              stderr += chunk;
              done();
            },
          }),
        },
      });
      process.exitCode = undefined;
      await main(argv, f);
      assert.equal(process.exitCode, 2, argv.join(" "));
      const output = decode(stdout) as { error: string; help: unknown };
      assert.equal(typeof output.error, "string");
      assert.ok(output.help);
      assert.equal(stderr, "");
      assert.equal(dependencies, 0, argv.join(" "));
    }
  } finally {
    process.exitCode = oldCode;
  }
});
