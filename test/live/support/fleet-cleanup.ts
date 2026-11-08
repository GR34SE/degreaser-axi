import { existsSync } from "node:fs";
import { cp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import {
  cleanInterruptedOwner,
  ownerAlive,
} from "../../../src/state/ownership.ts";
import type { ProcessIdentity, Run } from "../../../src/state/run.ts";
import { processes, sameProcess } from "./fleet-resources.ts";

interface FleetCleanup {
  signal: () => void;
  agent: string;
  model: string;
  cwd: string;
  evidenceDir: string;
  evidence: Record<string, unknown>;
  known: ProcessIdentity[];
  samples: unknown[];
  monitorStop: AbortController;
  monitor: Promise<void> | undefined;
  release: (() => void) | undefined;
  latest: () => Run | undefined;
  cancel: () => Promise<unknown> | undefined;
  getRun: () => Run | undefined;
  getSafetyFailure: () => string | undefined;
  policy: () => unknown;
  before: unknown;
}
export async function finalizeFleet(context: FleetCleanup) {
  const {
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
    getRun,
    getSafetyFailure,
    policy,
    before,
  } = context;
  const cleanupErrors: string[] = [];
  const safely = async <T>(stage: string, action: () => T | Promise<T>) => {
    try {
      return await action();
    } catch {
      cleanupErrors.push(stage);
      return undefined;
    }
  };

  await safely("cancel", cancel);
  await safely("owner join", async () => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const owner = latest()?.owner;
      if (!owner || !ownerAlive(owner)) return;
      await setTimeout(100);
    }
    throw new Error("Owner did not exit");
  });
  monitorStop.abort();
  await safely("monitor join", () => monitor);
  process.off("SIGINT", signal);
  process.off("SIGTERM", signal);
  const run = getRun();
  const ownerJoined = await safely(
    "owner inspection",
    () => !run?.owner || !ownerAlive(run.owner),
  );
  if (ownerJoined && run?.owner && known.length) {
    const cleanupRun = {
      ...run,
      owner: {
        ...run.owner,
        processes: known.filter((p) => p.pid !== run?.owner?.pid),
      },
    };
    await safely("remaining owned cleanup", () =>
      cleanInterruptedOwner(cleanupRun),
    );
  }
  const remaining = await safely("remaining process inspection", () =>
    processes().filter((row) => known.some((p) => sameProcess(row, p))),
  );
  evidence.cleanup = {
    ownerJoined,
    trackedProcesses: known.length,
    remaining: remaining?.map((p) => p.pid) ?? "unverified",
  };
  evidence.globalPolicyUnchanged = await safely(
    "global policy inspection",
    () => JSON.stringify(policy()) === JSON.stringify(before),
  );
  evidence.safetyFailure = getSafetyFailure() ?? null;
  evidence.samples = samples;
  evidence.cleanupErrors = cleanupErrors;
  evidence.run = run;
  if (existsSync(join(cwd, ".degreaser"))) {
    await safely("history preservation", () =>
      cp(join(cwd, ".degreaser"), join(evidenceDir, "history"), {
        recursive: true,
      }),
    );
  }
  if (ownerJoined && remaining?.length === 0 && cleanupErrors.length === 0)
    await safely("fixture removal", () =>
      rm(cwd, { recursive: true, force: true }),
    );
  if (existsSync(cwd)) evidence.retainedFixture = cwd;
  if (release) await safely("pilot lock release", release);
  if (
    !ownerJoined ||
    remaining?.length !== 0 ||
    !evidence.globalPolicyUnchanged ||
    getSafetyFailure() ||
    cleanupErrors.length
  ) {
    evidence.passed = false;
    process.exitCode = 1;
  }
  const written = await safely("evidence write", async () => {
    await writeFile(
      join(evidenceDir, "evidence.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      { mode: 0o600 },
    );
    return true;
  });
  if (!written) {
    evidence.passed = false;
    process.exitCode = 1;
  }
  console.log(
    JSON.stringify(
      {
        agent,
        model,
        passed: evidence.passed,
        run: run?.id,
        status: run?.status,
        admission: evidence.admission,
        failure: evidence.failure,
        safetyFailure: evidence.safetyFailure,
        cleanup: evidence.cleanup,
        cleanupErrors,
        samples: samples.length,
        evidence: join(evidenceDir, "evidence.json"),
      },
      null,
      2,
    ),
  );
}
