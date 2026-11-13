import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "../../../test/utils/git-fixture.ts";
import { prepareReview } from "../../../test/utils/input.ts";
import { block, clean, finding } from "../../../test/utils/result-fixture.ts";
import { runtime } from "../../../test/utils/runtime.ts";
import { pathSizes, takePortion } from "../../review/ingest/coverage.ts";
import { ingestResult } from "../../review/ingest/verify-quotes.ts";
import { createRun } from "../../review/prepare/create.ts";
import { git } from "./exec.ts";
import { repositoryRoot } from "./repository.ts";

const request = ["--scope", "worktree", "--task", "Review source"];

test("repository discovery preserves nested roots and the genuine not-repository diagnostic", (t) => {
  const f = fixture(t, false);
  const nested = join(f.root, "nested");
  mkdirSync(nested);
  assert.equal(repositoryRoot(runtime(), nested), f.root);
  const outside = mkdtempSync(join(tmpdir(), "degreaser-not-repository-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  assert.throws(() => repositoryRoot(runtime(), outside), {
    name: "InputError",
    message: /Not inside a Git repository/,
  });
});

test("fatal Git configuration errors are not reported as a missing repository", (t) => {
  const f = fixture(t, false);
  f.write(".git/config", "[private-config-sentinel\n");
  assert.throws(() => repositoryRoot(runtime(), f.root), {
    name: "InputError",
    message:
      "Git rev-parse failed while resolving review input. Check repository state, available history, filters and filesystem access; no run was started.",
  });
  assert.equal(existsSync(join(f.root, ".degreaser")), false);
});

test("run creation distinguishes a fatal ignore check from a missing ignore rule", (t) => {
  const f = fixture(t, false);
  f.write("source.ts", "export const value = 1;\n");
  const input = prepareReview(request, f.root);
  f.write(".git/config", "[private-config-sentinel\n");
  assert.throws(() => createRun(runtime(), input), {
    name: "InputError",
    message:
      "Git check-ignore failed while resolving review input. Check repository state, available history, filters and filesystem access; no run was started.",
  });
  assert.equal(existsSync(join(f.root, ".degreaser")), false);
});

test("run creation still asks for the state ignore rule when Git reports no match", (t) => {
  const f = fixture(t, false);
  f.write("source.ts", "export const value = 1;\n");
  const input = prepareReview(request, f.root);
  f.write(".gitignore", ".degreaserrc.json\n");
  assert.throws(() => createRun(runtime(), input), {
    name: "InputError",
    message: /Add \/\.degreaser\/ to the root \.gitignore before review/,
  });
  assert.equal(existsSync(join(f.root, ".degreaser")), false);
});

test("optional blob failures retain conservative coverage sizing and incomplete quote validation", (t) => {
  const f = fixture(t, false);
  const source = "// source explanation\n";
  f.write("source.ts", source);
  const input = prepareReview(request, f.root);
  f.write(".git/config", "[private-config-sentinel\n");
  const sizes = pathSizes(runtime(), input);
  assert.equal(sizes.size, 0);
  assert.deepEqual(takePortion(["source.ts", ".gitignore"], sizes, 10, 100), [
    "source.ts",
  ]);
  const { result, rejections } = ingestResult(
    runtime(),
    block({
      ...clean,
      status: "findings",
      findings: [finding("source.ts", "new", source)],
      examinedPaths: ["source.ts"],
    }),
    "low-value-comments",
    input,
  );
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.examinedPaths, []);
  assert.deepEqual(rejections, [{ index: 1, reason: "source-unavailable" }]);
});

test("optional Git failures never swallow spawn errors or permission denial", (t) => {
  const f = fixture(t, false);
  const bin = join(f.root, "bin");
  mkdirSync(bin);
  const rt = runtime({ env: { ...process.env, PATH: bin } });
  const run = () =>
    git(rt, f.root, ["rev-parse", "--show-toplevel"], {
      allowFailure: () => true,
    });
  assert.throws(run, {
    name: "InputError",
    message: /Git rev-parse failed while resolving review input/,
  });
  f.write("bin/git", "#!/bin/sh\nexit 0\n");
  assert.throws(run, {
    name: "DiagnosticError",
    diagnosis: "permission",
    message: "Git rev-parse review input operation failed (permission).",
  });
});

test("Git that exits before reading its input is judged by its exit status and stderr", (t) => {
  const f = fixture(t, false);
  // Larger than a pipe buffer, so the write cannot finish before Git exits.
  const input = "0".repeat(4 * 1024 * 1024);
  const batch = (rt = runtime()) =>
    git(rt, f.root, ["cat-file", "--batch-check"], {
      input,
      allowFailure: () => true,
    });
  f.write(".git/config", "[private-config-sentinel\n");
  assert.equal(batch(), null);
  const bin = join(f.root, "bin");
  f.write(
    "bin/git",
    "#!/bin/sh\necho 'fatal: unable to access .git/config: Permission denied' >&2\nexit 128\n",
  );
  chmodSync(join(bin, "git"), 0o755);
  assert.throws(() => batch(runtime({ env: { ...process.env, PATH: bin } })), {
    name: "DiagnosticError",
    diagnosis: "permission",
    message: "Git cat-file review input operation failed (permission).",
  });
});
