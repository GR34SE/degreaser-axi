import assert from "node:assert/strict";
import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fixture as gitFixture } from "../../../test/utils/git-fixture.ts";

import { prepareReview } from "../../../test/utils/input.ts";
import { runtime } from "../../../test/utils/runtime.ts";
import type { ReviewInput } from "../types.ts";
import { parseFinder } from "./parse.ts";
import { ingestFinder, ingestVerifier } from "./verify-quotes.ts";

const fixture = (t: Parameters<typeof gitFixture>[0]) => {
  const f = gitFixture(t);
  f.write(
    ".degreaserrc.json",
    JSON.stringify({
      agent: "codex",
      model: "gpt-6-luna",
      verifier: { model: "gpt-6-luna" },
    }),
  );
  return f;
};
const clean = {
  aspect: "low-value-comments",
  status: "no-findings",
  findings: [],
  limitations: [],
};
const block = (data: unknown) =>
  `<degreaser-result>${JSON.stringify(data)}</degreaser-result>`;
const finding = (
  path: string,
  side: "old" | "new",
  quote: string,
  startLine = 1,
  endLine = startLine,
) => ({
  location: { path, side, startLine, endLine },
  quote,
  title: "Redundant explanation",
});
const ingestResult = (
  runtime: ReturnType<typeof import("../../../test/utils/runtime.ts").runtime>,
  text: string,
  aspect: Parameters<typeof ingestFinder>[2],
  input: ReviewInput,
) => ingestFinder(runtime, text, aspect, input);

test("a unique whole-line quote corrects only an omitted final line", (t) => {
  const f = fixture(t);
  const quote = "function label(value: string) {\n  return value.trim();\n}";
  f.write("unique.ts", `export {};\n${quote}\n`);
  f.write("repeated.ts", `export {};\n${quote}\n${quote}\n`);
  const input = prepareReview(
    ["--scope", "repository", "--task", "Review", "--aspects", "missed-reuse"],
    f.root,
  );
  const original = finding("unique.ts", "new", quote, 2, 3);
  const proposed = [
    original,
    finding("repeated.ts", "new", quote, 2, 3),
    finding("unique.ts", "new", quote, 3, 4),
    finding("unique.ts", "new", quote, 2, 2),
    finding("unique.ts", "new", quote.slice(1), 2, 3),
  ];
  const result = ingestResult(
    runtime(),
    block({
      ...clean,
      aspect: "missed-reuse",
      status: "findings",
      findings: proposed,
    }),
    "missed-reuse",
    input,
  );
  assert.deepEqual(result.result.findings, [
    { ...original, location: { ...original.location, endLine: 4 } },
  ]);
  assert.deepEqual(
    result.rejections.map((r) => r.reason),
    Array(4).fill("quote-mismatch"),
  );
});

test("literal persisted old/new quotes survive mixed rejection, with zero neighborhood tolerance", (t) => {
  const f = fixture(t);
  f.write("removed.ts", "// removed explanation\nexport const old = 1;\n");
  f.write("current.ts", "export const value = 1;\n");
  f.git("add", ".");
  f.git("commit", "-m", "Old source");
  f.git("rm", "removed.ts");
  f.write(
    "current.ts",
    "// new explanation\nexport const value = 2;\n// nearby\n",
  );
  const input = prepareReview(
    [
      "--scope",
      "worktree",
      "--task",
      "Update value",
      "--aspects",
      "low-value-comments",
    ],
    f.root,
  );
  f.write("current.ts", "later live mutation must not validate quotes\n");
  const proposed = [
    finding("current.ts", "new", "// new explanation"),
    finding("removed.ts", "old", "// removed explanation"),
    finding("absent.ts", "new", "missing"),
    finding("removed.ts", "new", "// removed explanation"),
    finding("current.ts", "new", "// new explanation", 900),
    finding("current.ts", "new", "fabricated"),
    finding("current.ts", "new", "// nearby", 2),
  ];
  const result = ingestResult(
    runtime(),
    block({ ...clean, status: "findings", findings: proposed }),
    "low-value-comments",
    input,
  );
  assert.equal(result.result.status, "findings");
  assert.deepEqual(result.result.findings, proposed.slice(0, 2));
  assert.deepEqual(
    result.rejections.map((r) => r.reason),
    [
      "path-not-assessed",
      "side-unavailable",
      "range-out-of-bounds",
      "quote-mismatch",
      "quote-mismatch",
    ],
  );
  const rejected = ingestResult(
    runtime(),
    block({ ...clean, status: "findings", findings: proposed.slice(2) }),
    "low-value-comments",
    input,
  );
  assert.equal(rejected.result.status, "incomplete");
  assert.equal(rejected.result.findings.length, 0);
  assert.match(rejected.result.limitations.join(" "), /rejected/i);
});

test("quotes tolerate CRLF, copied diff markers and repo-path spellings but never absent or trivial text", (t) => {
  const f = fixture(t);
  f.write("crlf.ts", "const a = 1;\r\nconst B = 2;\r\nreturn null;\r\n");
  f.git("add", ".");
  f.git("commit", "-m", "Base");
  f.write("crlf.ts", "const a = 1;\r\nconst B = 3;\r\nreturn null;\r\n");
  const input = prepareReview(
    [
      "--scope",
      "worktree",
      "--task",
      "Edit",
      "--aspects",
      "low-value-comments",
    ],
    f.root,
  );
  const ingest = (findings: ReturnType<typeof finding>[]) =>
    ingestResult(
      runtime(),
      block({ ...clean, status: "findings", findings }),
      "low-value-comments",
      input,
    );
  const accepted = [
    finding("crlf.ts", "new", "const a = 1;\nconst B = 3;", 1, 2),
    finding("crlf.ts", "new", "+const a = 1;\n+const B = 3;", 1, 2),
    finding("crlf.ts", "new", " const a = 1;\n+const B = 3;", 1, 2),
    finding("crlf.ts", "old", "-const B = 2;", 2),
    finding("crlf.ts", "new", "return null;", 3),
    finding("./crlf.ts", "new", "const B = 3;", 2),
    finding(`${input.repository}/crlf.ts`, "new", "const B = 3;", 2),
  ];
  const ok = ingest(accepted);
  assert.deepEqual(ok.rejections, []);
  assert.deepEqual(
    ok.result.findings.map((x) => x.location.path),
    accepted.slice(1).map(() => "crlf.ts"),
  );
  const rejected = [
    finding("crlf.ts", "new", "c", 1, 3),
    finding("crlf.ts", "new", "+3;", 2),
    finding("crlf.ts", "new", "+;\n+r", 2, 3),
    finding("crlf.ts", "new", "-const B = 3;", 2),
    finding("crlf.ts", "new", "+const a = 1;\nconst B = 3;", 1, 2),
    finding("crlf.ts", "new", "+const B = 2;", 2),
    finding("crlf.ts", "new", "const a = 1;\nconst B = 9;", 1, 2),
  ];
  const bad = ingest(rejected);
  assert.deepEqual(
    bad.rejections.map((r) => r.reason),
    rejected.map(() => "quote-mismatch"),
  );
  assert.throws(
    () =>
      parseFinder(
        block({
          ...clean,
          status: "findings",
          findings: [finding("/etc/passwd", "new", "root")],
        }),
        "low-value-comments",
        input.repository,
      ),
    /schema/,
  );
});

test("symlink quotes validate against the link blob", (t) => {
  const f = fixture(t);
  f.write("skills/real/SKILL.md", "# Real\n");
  symlinkSync("../skills/real", join(f.root, "dir-link"));
  symlinkSync("skills/real/SKILL.md", join(f.root, "file-link"));
  symlinkSync("old-target", join(f.root, "moved link"));
  f.git("add", ".");
  f.git("commit", "-m", "Links");
  rmSync(join(f.root, "moved link"));
  symlinkSync("new-target", join(f.root, "moved link"));
  symlinkSync("does-not-exist", join(f.root, "dangling"));
  symlinkSync("/etc/hosts", join(f.root, "naïve external"));
  const argv = (scope: string) => [
    "--scope",
    scope,
    "--task",
    "Review links",
    "--aspects",
    "low-value-comments",
  ];
  const input = prepareReview(argv("worktree"), f.root);
  const byPath = new Map(input.paths.map((p) => [p.path, p]));
  assert.equal(byPath.get("moved link")?.oldLink, "old-target");
  assert.equal(byPath.get("moved link")?.newLink, "new-target");
  assert.equal(byPath.get("dangling")?.newLink, "does-not-exist");
  assert.equal(byPath.get("naïve external")?.newLink, "/etc/hosts");
  assert.equal(byPath.get("dir-link"), undefined);
  const run = (path: string, side: "old" | "new", quote: string) =>
    ingestResult(
      runtime(),
      block({
        ...clean,
        status: "findings",
        findings: [finding(path, side, quote)],
      }),
      "low-value-comments",
      input,
    ).rejections.map((r) => r.reason);
  assert.deepEqual(run("moved link", "new", "new-target"), []);
  assert.deepEqual(run("moved link", "old", "old-target"), []);
  assert.deepEqual(run("moved link", "new", "old-target"), ["quote-mismatch"]);
  assert.deepEqual(run("dangling", "new", "does-not-exist"), []);

  const audit = prepareReview(argv("repository"), f.root);
  const dir = audit.paths.find((p) => p.path === "dir-link");
  assert.equal(dir?.newLink, "../skills/real");
});

test("a finding outside the shard is not assessed, exact repeats collapse and kept quotes are checked", (t) => {
  const f = fixture(t);
  f.write("a.ts", "// first\nexport const a = 1;\n");
  f.write("b.ts", "// second\n");
  const input = prepareReview(
    [
      "--scope",
      "repository",
      "--task",
      "Audit",
      "--aspects",
      "low-value-comments",
    ],
    f.root,
  );
  const shard = {
    ...input,
    paths: input.paths.filter((p) => p.path === "a.ts"),
  };
  const first = finding("a.ts", "new", "// first");
  const { result, rejections } = ingestFinder(
    runtime(),
    block({
      ...clean,
      status: "findings",
      findings: [first, first, finding("b.ts", "new", "// second")],
      kept: [
        { location: first.location, quote: "// first" },
        { location: first.location, quote: "invented text" },
      ],
    }),
    "low-value-comments",
    shard,
  );
  assert.deepEqual(result.findings, [first]);
  assert.deepEqual(rejections, [{ index: 3, reason: "path-not-assessed" }]);
  assert.deepEqual(result.kept, [
    { location: first.location, quote: "// first" },
  ]);
  assert.match(result.limitations.join(" "), /Dropped 1 kept unit/);
  assert.equal(result.status, "findings");
});

test("verifier verdicts need a known candidate, an action when upheld and a matching evidence quote", (t) => {
  const f = fixture(t);
  f.write("helper.ts", "export const trim = (v: string) => v.trim();\n");
  f.write("a.ts", "export const a = 1;\n");
  f.git("add", ".");
  f.git("commit", "-m", "Base");
  f.write("a.ts", "export const a = 2;\n");
  const input = prepareReview(
    ["--scope", "worktree", "--task", "Edit", "--aspects", "missed-reuse"],
    f.root,
  );
  const helper = {
    location: { path: "helper.ts", side: "new", startLine: 1, endLine: 1 },
    quote: "export const trim = (v: string) => v.trim();",
  };
  const verdicts = [
    {
      candidate: 1,
      verdict: "upheld",
      reason: "Reuse.",
      action: "Use trim.",
      evidence: helper,
    },
    { candidate: 2, verdict: "refuted", reason: "Distinct." },
    { candidate: 3, verdict: "upheld", reason: "Out of range.", action: "x" },
    { candidate: 2, verdict: "upheld", reason: "Repeat.", action: "x" },
    { candidate: 2, verdict: "upheld", reason: "No action." },
    {
      candidate: 1,
      verdict: "upheld",
      reason: "Bad evidence.",
      action: "x",
      evidence: { ...helper, quote: "invented" },
    },
  ];
  const { result, dropped } = ingestVerifier(
    runtime(),
    block({
      aspect: "missed-reuse",
      status: "verdicts",
      verdicts,
      limitations: [],
    }),
    "missed-reuse",
    input,
    2,
  );
  assert.deepEqual(result.verdicts, verdicts.slice(0, 2));
  assert.equal(dropped, 4);
  assert.match(result.limitations.join(" "), /Discarded 4 verdict/);
  const late = ingestVerifier(
    runtime(),
    block({
      aspect: "missed-reuse",
      status: "verdicts",
      verdicts: [{ ...verdicts[1], candidate: 1 }, verdicts[0]],
      limitations: [],
    }),
    "missed-reuse",
    input,
    1,
  );
  assert.deepEqual(
    late.result.verdicts.map((v) => v.verdict),
    ["refuted"],
  );
});
