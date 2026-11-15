import assert from "node:assert/strict";
import test from "node:test";
import type { Finding } from "../review/ingest/types.ts";
import type { Run, RunInput, RunTask } from "../state/run.ts";
import { exportRun, findings, renderFinding, renderReport } from "./index.ts";
import type { ReportContext } from "./types.ts";

const at = (path: string, startLine: number, endLine = startLine) => ({
  path,
  side: "new" as const,
  startLine,
  endLine,
});
const finding = (
  path: string,
  line: number,
  verdict: Finding["verdict"],
  extra: Partial<Finding> = {},
): Finding => ({
  location: at(path, line),
  quote: `q${line}`,
  title: `t${line}`,
  verdict,
  ...(verdict === "upheld" ? { action: "Inline it." } : {}),
  ...extra,
});

function task(
  aspect: string,
  fs: Finding[],
  status: RunTask["status"] = "findings",
  attempts: RunTask["attempts"] = [],
) {
  return {
    assignment: { aspect, agent: "codex", model: "m" },
    promptHash: "h",
    status,
    result: { aspect, status, findings: fs, limitations: [] },
    rejections: [],
    attempts,
    limitations: [],
    usage: null,
  } as unknown as RunTask;
}

const attempt = (stage: "find" | "verify", index: number) =>
  ({
    startedAt: 0,
    endedAt: 1,
    sessionId: null,
    failure: null,
    stage,
    portion: { index, paths: 1 },
  }) as RunTask["attempts"][number];

const run = (tasks: RunTask[]) =>
  ({ id: "r1", status: "completed", tasks, deadline: 0 }) as unknown as Run;
const context = (): ReportContext => ({
  input: {
    scope: "worktree",
    task: "t",
    paths: [{}, {}],
    limitations: [],
    config: { assignments: [] },
    coordinatorResults: [],
  } as unknown as RunInput,
  status: "completed",
  unverifiedOwner: false,
  now: 0,
  harnessLimitations: {},
  ownerRecovery: "",
  reviewCommand: "review",
});

const sample = () =>
  run([
    task("unnecessary-complexity", [
      finding("b.ts", 9, "upheld"),
      finding("a.ts", 20, "refuted", { reason: "Needed." }),
      finding("a.ts", 5, "upheld"),
    ]),
    task(
      "low-value-comments",
      [
        finding("a.ts", 1, "unverified"),
        finding("a.ts", 2, "refuted", {
          reason: "Used",
          evidence: { location: at("c.ts", 3, 4), quote: "caller()" },
        }),
      ],
      "incomplete",
      [attempt("find", 0), attempt("find", 1), attempt("verify", 0)],
    ),
  ]);

test("ids put upheld findings first in path order, whatever the task order", () => {
  const forward = findings(sample()).map(
    (f) => `${f.id}:${f.verdict}:${f.title}`,
  );
  const reversed = sample();
  reversed.tasks.reverse();
  assert.deepEqual(
    findings(reversed).map((f) => `${f.id}:${f.verdict}:${f.title}`),
    forward,
  );
  assert.deepEqual(forward.slice(0, 2), ["F1:upheld:t5", "F2:upheld:t9"]);
});

test("default report lists every upheld finding by path with counts, hiding others", () => {
  const many = run([
    task(
      "unnecessary-complexity",
      Array.from({ length: 45 }, (_, i) => finding("a.ts", i + 1, "upheld")),
    ),
  ]);
  const out = renderReport(many, context());
  const rows = (r: { findings: unknown }) =>
    r.findings as Record<string, { id: string }[]>;
  assert.equal(out.upheld, 45);
  assert.equal(rows(out)["a.ts"]?.length, 45);
  const mixed = renderReport(sample(), context());
  assert.deepEqual([mixed.upheld, mixed.refuted, mixed.unverified], [2, 2, 1]);
  assert.deepEqual(Object.keys(rows(mixed)), ["a.ts", "b.ts"]);
  assert.deepEqual(rows(mixed)["a.ts"]?.[0], {
    id: "F1",
    aspect: "unnecessary-complexity",
    lines: "new:5-5",
    action: "Inline it.",
  });
  assert.ok(mixed.help.some((h) => h.includes("--full")));
  assert.equal(mixed.coverageBasis, "coordinator-assigned");
});

test("coverage counts verdicts per aspect and summarizes stages tersely", () => {
  const { coverage } = renderReport(sample(), context());
  const comments = coverage.find((c) => c.aspect === "low-value-comments");
  assert.equal(comments?.unverified, 1);
  assert.equal(comments?.refuted, 1);
  assert.equal(comments?.stages, "2 finders, 1 verifier");
});

test("--full shows refuted and unverified findings with reason and evidence", () => {
  const out = renderReport(sample(), context(), true);
  const all = out.findings as { id: string; verdict: string }[];
  assert.equal(all.length, 5);
  const refuted = all.find((f) => f.verdict === "refuted" && "evidence" in f);
  assert.deepEqual((refuted as unknown as { evidence: unknown }).evidence, {
    at: "c.ts:new:3-4",
    quote: "caller()",
  });
});

test("finding shows verdict, title, quote and evidence", () => {
  const out = renderFinding(sample(), context(), "F4");
  assert.equal(out.verdict, "refuted");
  assert.equal(out.title, "t2");
  assert.equal(out.reason, "Used");
  assert.equal(out.aspectStatus, "incomplete");
});

test("export carries flattened new fields and coordinator-assigned coverage", () => {
  const out = JSON.parse(exportRun(sample(), context()));
  assert.equal(out.coverageBasis, "coordinator-assigned");
  assert.deepEqual(Object.keys(out.findings[0]).sort(), [
    "action",
    "aspect",
    "endLine",
    "id",
    "path",
    "quote",
    "side",
    "startLine",
    "title",
    "verdict",
  ]);
});
