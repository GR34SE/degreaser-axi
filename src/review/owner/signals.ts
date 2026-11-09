import { join } from "node:path";
import { captureOwner } from "../../state/ownership.ts";
import type { Run } from "../../state/run.ts";
import { saveRun } from "../../state/store.ts";
import { StateError } from "../../util/errors.ts";
import type { Runtime } from "../../util/exec/types.ts";

export function ownerControl(
  runtime: Runtime,
  run: Run,
  execution: NonNullable<Run["executions"]>[number],
  dir: string,
) {
  const abort = new AbortController();
  let stopReason = "cancelled";
  const stop = () => {
    if (!abort.signal.aborted) {
      if (stopReason === "cancelled" || stopReason === "deadline")
        execution.stopReason = stopReason;
      abort.abort();
    }
  };
  const expire = () => {
    if (!abort.signal.aborted) {
      stopReason = "deadline";
      stop();
    }
  };
  const stopped = () => {
    if (runtime.now() >= run.deadline) expire();
    return abort.signal.aborted;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const deadline = setTimeout(
    expire,
    Math.max(1, run.deadline - runtime.now()),
  );
  let persistenceError: StateError | undefined;
  let fatalError: StateError | undefined;
  const persist = (verify = false) => {
    if (persistenceError) throw persistenceError;
    try {
      run.owner = captureOwner(run.owner);
    } catch (error) {
      if (verify || !run.owner)
        throw fail(error, "Owner process identities could not be captured.");
      if (!(error instanceof StateError)) throw error;
      run.owner = { ...run.owner, heartbeat: runtime.now() };
    }
    try {
      saveRun(run);
    } catch (error) {
      persistenceError =
        error instanceof StateError
          ? error
          : new StateError(
              "state-write-failed",
              `Could not persist run: ${join(dir, "run.json")}`,
            );
      throw persistenceError;
    }
  };
  const fail = (error: unknown, message: string) => {
    fatalError ??=
      error instanceof StateError
        ? error
        : new StateError("owner-failed", message);
    stopReason = fatalError.code;
    stop();
    return fatalError;
  };
  const heartbeat = setInterval(() => {
    try {
      persist();
    } catch (error) {
      fail(error, "Owner heartbeat could not be persisted.");
    }
  }, 2000);
  return {
    abort,
    stopped,
    persist,
    fail,
    get stopReason() {
      return stopReason;
    },
    get fatalError() {
      return fatalError;
    },
    get persistenceError() {
      return persistenceError;
    },
    dispose() {
      clearInterval(heartbeat);
      clearTimeout(deadline);
      process.off("SIGTERM", stop);
      process.off("SIGINT", stop);
    },
  };
}
export type OwnerControl = ReturnType<typeof ownerControl>;
