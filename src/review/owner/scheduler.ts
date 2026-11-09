import type { RunTask } from "../../state/run.ts";
import type { OwnerControl } from "./signals.ts";

export async function schedule(
  pending: RunTask[],
  limit: number,
  work: (task: RunTask, started?: () => void) => Promise<void>,
  control: OwnerControl,
  active: Set<Promise<void>>,
) {
  const { stopped, fail } = control;
  if (pending.length) {
    let warmed = false;
    let release = () => {};
    const warm = new Promise<void>((resolve) => {
      release = () => {
        warmed = true;
        resolve();
      };
    });
    const launch = (task: RunTask, started?: () => void) => {
      const promise = work(task, started)
        .catch((error: unknown) => {
          fail(
            error,
            `Aspect ${task.assignment.aspect} could not complete because of an unexpected owner task error.`,
          );
        })
        .finally(() => {
          active.delete(promise);
        });
      active.add(promise);
      return promise;
    };
    for (const task of pending) {
      if (stopped()) break;
      if (active.size >= limit) await Promise.race(active);
      if (stopped()) break;
      const work = launch(task, release);
      if (!warmed) await Promise.race([warm, work]);
    }
    await Promise.all(active);
  }
}
