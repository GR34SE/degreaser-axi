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

const attempt = (stage: "find" | "verify") =>
  ({
    startedAt: 0,
    endedAt: 1,
    sessionId: null,
    failure: null,
    stage,
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
      [attempt("find"), attempt("find"), attempt("verify")],
    ),
  ]);

test("ids follow location order, whatever the task order, and survive a later verdict", () => {
  const ids = (r: Run) =>
    findings(r).map((f) => `${f.id}:${f.location.path}:${f.title}`);
  const forward = ids(sample());
  const reversed = sample();
  reversed.tasks.reverse();
  assert.deepEqual(ids(reversed), forward);
  assert.deepEqual(forward.slice(0, 3), [
    "F1:a.ts:t1",
    "F2:a.ts:t2",
    "F3:a.ts:t5",
  ]);
  const verified = sample();
  const pending = verified.tasks[1]?.result?.findings[0];
  assert.ok(pending);
  Object.assign(pending, { verdict: "upheld", action: "Delete it." });
  assert.deepEqual(ids(verified), forward);
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
    id: "F3",
    aspect: "unnecessary-complexity",
    lines: "new:5-5",
    action: "Inline it.",
  });
  assert.deepEqual(mixed.unverifiedFindings, {
    "a.ts": [{ id: "F1", aspect: "low-value-comments", lines: "new:1-1" }],
  });
  assert.equal(renderReport(many, context()).unverifiedFindings, undefined);
  assert.ok(mixed.help.some((h) => h.includes("--full")));
  assert.equal(mixed.coverageBasis, "worker-declared");
});

test("coverage counts verdicts per aspect and summarizes stages tersely", () => {
  const { coverage } = renderReport(sample(), context());
  const comments = coverage.find((c) => c.aspect === "low-value-comments");
  assert.equal(comments?.unverified, 1);
  assert.equal(comments?.refuted, 1);
  assert.equal(comments?.stages, "2 finder sessions, 1 verifier session");
});

test("paths a finder did not examine are counted by default and listed in full", () => {
  const examined = (aspect: string, paths: string[]) => {
    const t = task(aspect, []);
    Object.assign(t.result ?? {}, { examinedPaths: paths });
    return t;
  };
  const sampled = run([
    examined("missed-reuse", ["a.ts"]),
    examined("scope-creep", ["a.ts", "b.ts"]),
  ]);
  const scoped = {
    ...context(),
    input: {
      ...context().input,
      paths: [{ path: "a.ts" }, { path: "b.ts" }],
    } as unknown as RunInput,
  };
  const rows = (full: boolean) =>
    renderReport(sampled, scoped, full).coverage.map((c) => [
      c.aspect,
      c.notExamined,
    ]);
  assert.deepEqual(rows(false), [
    ["missed-reuse", 1],
    ["scope-creep", undefined],
  ]);
  assert.deepEqual(rows(true), [
    ["missed-reuse", ["b.ts"]],
    ["scope-creep", undefined],
  ]);
  assert.equal(renderReport(sampled, scoped).status, "completed");
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
  const out = renderFinding(sample(), context(), "F2");
  assert.equal(out.verdict, "refuted");
  assert.equal(out.title, "t2");
  assert.equal(out.reason, "Used");
  assert.equal(out.aspectStatus, "incomplete");
});

test("export carries flattened new fields and worker-declared coverage", () => {
  const out = JSON.parse(exportRun(sample(), context()));
  assert.equal(out.coverageBasis, "worker-declared");
  const upheld = out.findings.find(
    (f: { verdict: string }) => f.verdict === "upheld",
  );
  assert.deepEqual(Object.keys(upheld).sort(), [
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

test("only a failure still open in the latest execution explains its aspect", () => {
  const limited = (stage: "find" | "verify", startedAt: number) =>
    ({
      ...attempt(stage),
      startedAt,
      failure: "rate-limited",
      diagnostic: { phase: "invocation" },
    }) as unknown as RunTask["attempts"][number];
  const later = (stage: "find" | "verify") => ({
    ...attempt(stage),
    startedAt: 10,
  });
  const cases = [
    { attempts: [limited("find", 0), later("find")], open: false },
    {
      attempts: [limited("verify", 10), later("verify"), later("find")],
      open: false,
    },
    { attempts: [later("find"), limited("find", 10)], open: true },
  ];
  for (const { attempts, open } of cases) {
    const unfinished = task("low-value-comments", [], "incomplete", attempts);
    unfinished.unresolved = { cause: "incomplete" };
    const out = renderReport(
      {
        ...run([unfinished]),
        status: "partial",
        deadline: 1,
        executions: [{ startedAt: 0 }, { startedAt: 10 }],
      } as Run,
      { ...context(), status: "partial" },
    );
    const [row] = out.coverage;
    assert.deepEqual(row?.cause, open ? { phase: "invocation" } : undefined);
    assert.equal(
      out.help.some((h) => h.includes("--concurrency 1")),
      open,
    );
  }
});
