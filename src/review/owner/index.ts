import { resumable, terminalStatus } from "../../state/run.ts";
import type { Runtime } from "../../util/exec/types.ts";
import type { ResumeControls } from "../types.ts";
import { admitRun } from "./admission.ts";
import { reviewAspect } from "./aspect.ts";
import type { OwnerContext } from "./context.ts";
import { ownerControl } from "./signals.ts";
import { slots } from "./slots.ts";

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
  const { abort, persist, fail } = control;
  const active = new Set<Promise<void>>();
  const context: OwnerContext = {
    runtime,
    repository,
    input,
    dir,
    startedAt: execution.startedAt,
    control,
    slots: slots(execution.concurrency ?? run.tasks.length),
  };
  try {
    ready();
    await Promise.all(
      run.tasks.filter(resumable).map((task) => {
        const promise = reviewAspect(context, task)
          .catch((error: unknown) => {
            fail(
              error,
              `Aspect ${task.assignment.aspect} could not complete because of an unexpected owner task error.`,
            );
          })
          .finally(() => active.delete(promise));
        active.add(promise);
        return promise;
      }),
    );
    if (control.fatalError) throw control.fatalError;
    run.status = terminalStatus(run.tasks);
    persist();
  } catch (error) {
    const failure = fail(
      error,
      "Run stopped because of an unexpected owner error.",
    );
    await Promise.allSettled(active);
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
