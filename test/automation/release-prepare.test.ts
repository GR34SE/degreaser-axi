import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fixture } from "../utils/git-fixture.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("preparation refuses dirty checkouts and never overwrites an existing destination", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, "tools/release"), { recursive: true });
  for (const name of ["prepare.ts", "notes.ts"])
    cpSync(
      join(root, "tools/release", name),
      join(f.root, "tools/release", name),
    );
  f.write(
    "package.json",
    '{"name":"degreaser-axi","version":"0.1.0","type":"module"}\n',
  );
  f.git("add", ".");
  f.git("commit", "-m", "Prepare fixture");
  const output = join(f.root, "ignored/candidate");
  f.write("ignored/candidate/keep.txt", "existing candidate\n");
  const run = () =>
    spawnSync(
      process.execPath,
      [
        join(f.root, "tools/release/prepare.ts"),
        "--since",
        "HEAD",
        "--output",
        output,
      ],
      { cwd: f.root, encoding: "utf8", timeout: 10_000 },
    );
  f.write("uncommitted.txt", "pending work");
  const dirty = run();
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /checkout changes/);
  f.git("add", "uncommitted.txt");
  f.git("commit", "-m", "Committed fixture change");
  const existing = run();
  assert.notEqual(existing.status, 0);
  assert.match(existing.stderr, /EEXIST/);
  assert.equal(
    readFileSync(join(output, "keep.txt"), "utf8"),
    "existing candidate\n",
  );
});

test("package checking refuses a nonempty retained destination before packing", (t) => {
  const f = fixture(t);
  f.write("ignored/tarballs/degreaser-axi-0.1.0.tgz", "previous tarball");
  const output = join(f.root, "ignored/tarballs");
  const result = spawnSync(
    process.execPath,
    [join(root, "test/package/check.ts"), "--pack-destination", output],
    { encoding: "utf8", timeout: 10_000 },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Pack destination must be empty/);
  assert.equal(
    readFileSync(join(output, "degreaser-axi-0.1.0.tgz"), "utf8"),
    "previous tarball",
  );
});
