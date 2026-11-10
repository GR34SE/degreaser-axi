import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { decode } from "@toon-format/toon";
import { environment, execute, git } from "./provider-process.mjs";
import { materialize } from "./provider-sample.mjs";
import reviewPolicy from "./review-policy.json" with { type: "json" };

const EXIT_CODES = {
  completed: 0,
  partial: 1,
  failed: 1,
  interrupted: 1,
  running: 3,
};
const RESOLVED = ["findings", "no-findings", "not-applicable"];
const NETWORK_CODES = new Set([
  "ETIMEDOUT",
  "TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

function outcome(result) {
  let value;
  try {
    value = decode(result.stdout.toString());
  } catch {
    throw new Error("Public CLI returned invalid TOON.");
  }
  if (
    result.code !== EXIT_CODES[value?.status] ||
    typeof value.run !== "string" ||
    !/^[\w-]+$/.test(value.run)
  )
    throw new Error("Public CLI returned an invalid review outcome.");
  return value;
}

function workerQuality(attempt) {
  const cause = attempt?.failure ?? null;
  if (["invalid-output", "output-limit"].includes(cause)) return true;
  const codes = [attempt?.diagnostic?.code, attempt?.diagnostic?.detailCode];
  return (
    [null, "timeout", "deadline"].includes(cause) &&
    !!attempt?.result &&
    !codes.some((code) => NETWORK_CODES.has(String(code).toUpperCase()))
  );
}

export function partialOutcome(data, full) {
  const unresolved = data.coverage.filter(
    (row) => !RESOLVED.includes(row.status),
  );
  if (full.failure || full.stopReason === "cancelled" || !unresolved.length)
    throw new Error(
      "Partial review has no attributable worker outcome; it is not rubric quality evidence.",
    );
  for (const row of unresolved) {
    const attempt = full.execution
      .find((execution) => execution.aspect === row.aspect)
      ?.attempts?.at(-1);
    if (!workerQuality(attempt))
      throw new Error(
        `Review ended partial after ${row.aspect} ${attempt?.failure ?? "unknown"} failure (recovery: ${attempt?.diagnostic?.recovery ?? "inspect"}); it is not rubric quality evidence.`,
      );
  }
  return "worker-quality-partial";
}

async function release(root, cli, env, runId) {
  const state = join(root, ".degreaser/state.json");
  const run =
    runId ??
    (existsSync(state)
      ? JSON.parse(await readFile(state, "utf8")).latestRunId
      : null);
  if (!run) return;
  const cancelled = outcome(
    await execute(process.execPath, [cli, "cancel", run], {
      cwd: root,
      env,
      deadline: Date.now() + 30_000,
    }),
  );
  const lock = join(root, ".degreaser/runs", run, "owner.lock");
  const until = Date.now() + 3000;
  while (existsSync(lock) && Date.now() < until) await delay(25);
  if (cancelled.status === "running" || existsSync(lock))
    throw new Error("Evaluation owner cleanup is unresolved.");
}

export async function reviewSample(
  sample,
  { productDir, agent, model, timeoutMs = 900_000, env: overrides, signal },
) {
  const started = Date.now();
  const deadline = started + timeoutMs;
  const cli = join(productDir, "dist/main.js");
  const env = environment(overrides);
  const root = await mkdtemp(join(tmpdir(), "degreaser-eval-"));
  let runId;
  let envelope;
  let failure;
  try {
    const productSha = (
      await git(productDir, ["rev-parse", "HEAD"], { env, deadline, signal })
    )
      .toString()
      .trim();
    const materialized = await materialize(sample, root, {
      env,
      deadline,
      signal,
    });
    await writeFile(
      join(root, ".degreaserrc.json"),
      JSON.stringify({ ...reviewPolicy, agent, model }),
    );
    const invoke = async (args) =>
      outcome(
        await execute(process.execPath, [cli, ...args], {
          cwd: root,
          env,
          deadline,
          signal,
          keepDescendants: () =>
            existsSync(join(root, ".degreaser/state.json")),
        }),
      );
    const args = [
      "review",
      "--scope",
      sample.review.scope,
      "--task",
      sample.review.task,
      "--aspects",
      sample.aspects.join(","),
      "--wait",
      "1",
    ];
    if (sample.review.scope === "branch")
      args.push("--base", materialized.base);
    for (const path of sample.review.paths) args.push("--path", path);
    let result = await invoke(args);
    runId = result.run;
    while (result.status === "running")
      result = await invoke(["wait", runId, "--wait", "1"]);
    if (!["completed", "partial"].includes(result.status))
      throw new Error(`Review ended ${result.status}.`);
    const exported = await execute(process.execPath, [cli, "export", runId], {
      cwd: root,
      env,
      deadline,
      signal,
    });
    let data;
    try {
      data = JSON.parse(exported.stdout.toString());
    } catch {
      throw new Error("Public CLI returned invalid JSON.");
    }
    if (
      exported.code !== 0 ||
      data.run !== runId ||
      data.status !== result.status
    )
      throw new Error("Public export does not match the terminal review.");
    const full = await invoke(["report", runId, "--full"]);
    if (
      !Array.isArray(full.execution) ||
      !Array.isArray(full.configuration) ||
      !full.configuration.length ||
      full.configuration.some(
        (row) => row.agent !== agent || row.model !== model,
      )
    )
      throw new Error("Review did not use the requested agent/model.");
    const sessionCount = full.execution
      .flatMap((row) => row.attempts)
      .filter((attempt) => typeof attempt.sessionId === "string").length;
    envelope = {
      sampleId: sample.id,
      export: data,
      meta: {
        productSha,
        agent,
        model,
        sampleHash: materialized.sampleHash,
        sessionCount,
        ...(data.status === "partial"
          ? { outcome: partialOutcome(data, full) }
          : {}),
      },
    };
  } catch (error) {
    failure = error;
  }
  try {
    await release(root, cli, env, runId);
    if (!failure?.cleanupFailed)
      await rm(root, { recursive: true, force: true });
  } catch {
    failure = { cleanupFailed: true };
  }
  if (failure?.cleanupFailed)
    throw new Error(
      `Evaluation cleanup failed; source and ownership state retained at ${root}. Run the public cancel command there before removing it.`,
    );
  if (failure) throw failure;
  envelope.meta.durationMs = Date.now() - started;
  return envelope;
}
