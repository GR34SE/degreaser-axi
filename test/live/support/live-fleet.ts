import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProcessIdentity, Run } from "../../../src/state/run.ts";
import { loadRun } from "../../../src/state/store.ts";
import { finalizeFleet } from "./fleet-cleanup.ts";
import { type FleetEvent, fleetEvidence } from "./fleet-evidence.ts";
import { quota } from "./fleet-quota.ts";
import {
  collectOwned,
  fleetLock,
  monitorFleet,
  otherLiveWork,
  processes,
  sameProcess,
  sampleMemory,
  unsafeMemory,
} from "./fleet-resources.ts";
import { digest, policy } from "./policy.ts";

const cli = fileURLToPath(new URL("../../../dist/main.js", import.meta.url));
const observer = fileURLToPath(
  new URL("./fleet-observer.mjs", import.meta.url),
);
export async function liveFleet(agent: "codex" | "claude", model: string) {
  assert.equal(
    process.platform,
    "darwin",
    "Fleet resource monitor requires macOS",
  );
  const root = fileURLToPath(
    new URL("../../../.degreaser/live-fleet/", import.meta.url),
  );
  await mkdir(root, { recursive: true });
  const evidenceDir = await mkdtemp(join(root, `${agent}-`));
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "degreaser-fleet-")));
  const trace = join(evidenceDir, "events.jsonl");
  const before = policy();
  const evidence: Record<string, unknown> = {
    case: "fleet",
    agent,
    model,
    passed: false,
    provenance:
      "Compiled CLI and detached owner with production profiles and official adapters; observer records callbacks only.",
    resourcePolicy:
      "1s host physical-page headroom samples, not summed RSS. Reserve 30% of baseline free+inactive+speculative pages. Cancel on critical pressure immediately, or three consecutive warning/70%-budget samples. Host delta includes unrelated activity.",
  };
  const known: ProcessIdentity[] = [];
  const samples: (ReturnType<typeof sampleMemory> & {
    ownedProcesses: number;
    ownedCpuPercent: number;
  })[] = [];
  let run: Run | undefined;
  const monitorStop = new AbortController();
  let monitor: Promise<void> | undefined;
  let release: (() => void) | undefined;
  let safetyFailure: string | undefined;
  let cancellation: Promise<unknown> | undefined;
  const command = (args: string[], timeout = 300_000) =>
    new Promise<{ code: number; stdout: string }>((resolve, reject) => {
      execFile(
        process.execPath,
        ["--import", observer, cli, ...args],
        {
          cwd,
          env: { ...process.env, DEGREASER_FLEET_TRACE: trace },
          timeout,
          maxBuffer: 1024 * 1024,
        },
        (error, stdout) => {
          if (error && typeof error.code !== "number")
            reject(new Error("Fleet CLI timed out or could not start"));
          else
            resolve({
              code: typeof error?.code === "number" ? error.code : 0,
              stdout,
            });
        },
      );
    });
  const latest = () => {
    if (existsSync(join(cwd, ".degreaser/state.json"))) run = loadRun(cwd);
    return run;
  };
  const cancel = () => {
    const current = latest();
    if (current?.status === "running")
      cancellation ??= command(["cancel", current.id], 30_000)
        .then((result) => {
          if (result.code !== 0 && result.code !== 1)
            throw new Error("Owned cancellation refused");
          return result;
        })
        .catch((error: unknown) => {
          cancellation = undefined;
          throw error;
        });
    return cancellation;
  };
  const signal = () => {
    safetyFailure = "Pilot interrupted";
  };
  process.on("SIGINT", signal);
  process.on("SIGTERM", signal);
  try {
    release = fleetLock(join(root, "active.lock"));
    assert.deepEqual(
      otherLiveWork(),
      [],
      "Another live owner/adapter is running",
    );
    evidence.quotaBefore = quota(agent, model);
    const baseline = sampleMemory();
    evidence.baseline = baseline;
    evidence.headroomBudgetBytes = baseline.headroomBytes * 0.7;
    assert.equal(
      baseline.pressure,
      1,
      "Host already reports actual memory pressure",
    );
    const git = (args: string[]) => {
      assert.equal(
        spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 })
          .status,
        0,
        "Synthetic Git setup failed",
      );
    };
    git(["init", "--initial-branch=main"]);
    await writeFile(
      join(cwd, ".gitignore"),
      "/.degreaser/\n.degreaserrc.json\n",
    );
    await writeFile(
      join(cwd, "sum.ts"),
      "export const sum = (a: number, b: number) => a + b;\n",
    );
    git(["add", "."]);
    git(["commit", "-m", "Synthetic fleet baseline"]);
    await writeFile(
      join(cwd, "sum.ts"),
      "// Return the sum of two numbers.\nexport const sum = (a: number, b: number) => a + b;\n",
    );
    await writeFile(
      join(cwd, ".degreaserrc.json"),
      JSON.stringify({
        schemaVersion: 1,
        agent,
        model,
        limits: { workerTimeoutSeconds: 180, runTimeoutSeconds: 240 },
      }),
    );
    const source = digest(join(cwd, "sum.ts")),
      index = digest(join(cwd, ".git/index"));
    let unsafe = 0;
    monitor = monitorFleet(
      {
        sample() {
          const memory = sampleMemory();
          const current = latest();
          let owned: ReturnType<typeof collectOwned> = [];
          if (current?.owner?.started) {
            const rows = processes();
            owned = collectOwned(
              rows,
              {
                pid: current.owner.pid,
                started: current.owner.started,
                group: current.owner.pid,
              },
              [...known, ...(current.owner.processes ?? [])],
            );
            for (const p of owned)
              if (!known.some((old) => sameProcess(old, p))) known.push(p);
          }
          samples.push({
            ...memory,
            ownedProcesses: owned.length,
            ownedCpuPercent: owned.reduce((n, p) => n + p.cpu, 0),
          });
          unsafe = unsafeMemory(baseline, memory) ? unsafe + 1 : 0;
          if (memory.pressure === 4 || unsafe >= 3)
            safetyFailure ??=
              "Actual host pressure or sustained consumption of 70% headroom budget";
          if (
            digest(join(cwd, "sum.ts")) !== source ||
            digest(join(cwd, ".git/index")) !== index
          )
            safetyFailure ??= "Synthetic source or index changed";
        },
        cancel,
        stopRequested: () => safetyFailure !== undefined,
        onFailure: (stage) => {
          safetyFailure ??= stage;
        },
      },
      monitorStop.signal,
    );
    assert.equal(safetyFailure, undefined, "Monitor failed before admission");
    const review = await command([
      "review",
      "--scope",
      "worktree",
      "--task",
      "Add a comment describing the numeric sum helper. Review only this synthetic change; do not execute code.",
      "--wait",
      "1",
    ]);
    evidence.review = review;
    assert.ok(
      review.code === 3 || review.code === 0 || review.code === 1,
      "Review admission failed",
    );
    latest();
    assert.ok(run, "No persisted fleet");
    const waited = await command(["wait", run.id, "--wait", "260"]);
    evidence.wait = waited;
    run = loadRun(cwd);
    evidence.report = await command(["report", run.id, "--full"]);
    evidence.run = run;
    const events: FleetEvent[] = readFileSync(trace, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    evidence.admission = fleetEvidence(run, events, agent, model);
    assert.equal(waited.code, 0, "Fleet wait did not complete");
    assert.equal(safetyFailure, undefined, safetyFailure);
    evidence.passed = true;
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : "Fleet failed";
    process.exitCode = 1;
  } finally {
    await finalizeFleet({
      signal,
      agent,
      model,
      cwd,
      evidenceDir,
      evidence,
      known,
      samples,
      monitorStop,
      monitor,
      release,
      latest,
      cancel,
      getRun: () => run,
      getSafetyFailure: () => safetyFailure,
      policy,
      before,
    });
  }
}
