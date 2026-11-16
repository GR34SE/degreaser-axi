import { setTimeout } from "node:timers/promises";
import type { RunTask } from "../../state/run.ts";
import type { OwnerContext } from "./context.ts";

export async function backOffThrottle(context: OwnerContext, task: RunTask) {
  const cap = context.slots.halve();
  context.execution.concurrency = cap;
  const notice = `Temporary provider throttling: waiting 2s before one retry; active-session cap is ${cap}.`;
  if (!task.limitations.includes(notice)) task.limitations.push(notice);
  context.control.persist();
  try {
    await setTimeout(2000, undefined, { signal: context.control.abort.signal });
  } catch (error) {
    if (!context.control.stopped()) throw error;
  }
  return !context.control.stopped();
}
