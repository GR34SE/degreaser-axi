import { resolved, terminalStatus } from "../../state/run.ts";
import type { Runtime } from "../../util/exec/types.ts";
import { pathSizes } from "../ingest/coverage.ts";
import type { ResumeControls } from "../types.ts";
import { admitRun } from "./admission.ts";
import { reviewAspect } from "./aspect.ts";
import type { OwnerContext } from "./context.ts";
import { schedule } from "./scheduler.ts";
import { ownerControl } from "./signals.ts";

/** Sole writer after admission; every owned child is joined before release. */
export async function ownRun(
  runtime: Runtime,
  repository: string,
  id: string,
  controls?: ResumeControls,
  ready: () => void = () => {},
) {
  const { run, input, dir, execution, unlockOwner } = await admitRun(
    runtime,
    repository,
    id,
    controls,
  );
  const control = ownerControl(runtime, run, execution, dir);
  const { abort, stopped, persist, fail } = control;
  const active = new Set<Promise<void>>();
  let sizes: Map<string, number> | undefined;
  const context: OwnerContext = {
    runtime,
    repository,
    input,
    dir,
    control,
    sizesOf: () => (sizes ??= pathSizes(runtime, input)),
  };
  try {
    ready();
    await schedule(
      run.tasks.filter((task) => !resolved(task)),
      input.config.concurrency ?? run.tasks.length,
      (task, started) => reviewAspect(context, task, started),
      control,
      active,
    );
    if (stopped()) {
      for (const task of run.tasks.filter(
        (task) => task.status === "pending",
      )) {
        task.status = "cancelled";
        task.limitations.push(`Unexamined aspect: ${control.stopReason}.`);
      }
    }
    if (control.fatalError) throw control.fatalError;
    run.status = terminalStatus(run.tasks);
    persist();
  } catch (error) {
    const failure = fail(
      error,
      "Run stopped because of an unexpected owner error.",
    );
    await Promise.allSettled(active);
    // A failed store cannot reliably record its own failure. Keep its last commit.
    if (!control.persistenceError) {
      execution.failure = {
        code: failure.code,
        message: failure.message,
      };
      for (const task of run.tasks) {
        if (task.status === "pending" || task.status === "running") {
          task.status = "failed";
          task.limitations.push(`Unexamined aspect: ${failure.code}.`);
        }
      }
      run.status = terminalStatus(run.tasks);
      persist();
    }
    throw failure;
  } finally {
    abort.abort();
    await Promise.allSettled(active);
    control.dispose();
    unlockOwner();
  }
}
