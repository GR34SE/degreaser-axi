import { join } from "node:path";
import type { RunTask } from "../../state/run.ts";
import { resolved } from "../../state/run.ts";
import { StateError } from "../../util/errors.ts";
import { executeAttempt } from "../attempt/index.ts";
import {
  assemblePrompt,
  continuationSection,
  obligationSection,
} from "../attempt/prompt/assemble.ts";
import {
  nextLimit,
  portionBounds,
  progressed,
  takePortion,
  uncovered,
} from "../ingest/coverage.ts";
import type { OwnerContext } from "./context.ts";

export async function reviewAspect(
  context: OwnerContext,
  task: RunTask,
  started: () => void = () => {},
) {
  const { input, dir, sizesOf, control } = context;
  const { stopped, persist } = control;
  const prompt = assemblePrompt(
    input,
    task.assignment.aspect,
    join(dir, "input", "patch.diff"),
  );
  if (prompt.promptHash !== task.promptHash)
    throw new StateError(
      "input-changed",
      `Prompt identity for ${task.assignment.aspect} differs from ${join(dir, "run.json")}. Start a new review with the current package.`,
    );
  const resumed =
    task.result?.status === "incomplete" &&
    (uncovered(input, task.result.examinedPaths ?? []).length > 0 ||
      (task.result.unresolved?.length ?? 0) > 0);
  let accumulated = resumed ? (task.result ?? null) : null;
  const bounds = portionBounds(input.config.limits.maxTurns);
  let limit = bounds.paths;
  const stuck = new Set<string>();
  let obligationsTried = false;
  for (;;) {
    const examined = accumulated?.examinedPaths ?? [];
    const remaining = uncovered(input, examined);
    const eligible = remaining.filter((p) => !stuck.has(p));
    const open = accumulated?.unresolved ?? [];
    let text: string;
    let passInput = input;
    let portion: string[] = [];
    const resolving =
      !remaining.length && resumed && open.length > 0 && !obligationsTried;
    if (eligible.length) {
      portion = takePortion(eligible, sizesOf(), limit, bounds.bytes);
      if (!accumulated && portion.length === eligible.length) {
        text = prompt.text;
      } else {
        const focus = new Set(portion);
        passInput = {
          ...input,
          paths: input.paths.filter((p) => focus.has(p.path)),
        };
        text = `${assemblePrompt(input, task.assignment.aspect, join(dir, "input", "patch.diff"), 0, focus).text}\n\n${continuationSection(portion, examined.length, remaining.length - portion.length)}`;
      }
    } else if (resolving) {
      const named = new Set(
        open
          .flatMap((u) => u.paths ?? [])
          .filter((p) => input.paths.some((i) => i.path === p)),
      );
      const focus = named.size ? named : undefined;
      if (focus)
        passInput = {
          ...input,
          paths: input.paths.filter((p) => focus.has(p.path)),
        };
      text = `${assemblePrompt(input, task.assignment.aspect, join(dir, "input", "patch.diff"), 0, focus).text}\n\n${obligationSection(open, examined.length)}`;
    } else break;
    const pass = await executeAttempt(
      context,
      task,
      text,
      passInput,
      accumulated,
      started,
      resolving,
    );
    if (!pass) {
      if (accumulated) {
        task.result = accumulated;
        if (task.status === "failed") task.status = "incomplete";
      }
      break;
    }
    const advanced = progressed(accumulated, pass);
    accumulated = pass;
    if (resolving) obligationsTried = true;
    if (
      pass.status !== "incomplete" ||
      stopped() ||
      task.attempts.at(-1)?.failure
    )
      break;
    if (!advanced && portion.length) {
      const next = nextLimit(portion.length);
      if (next) limit = next;
      else if (portion[0] !== undefined) stuck.add(portion[0]);
    } else if (
      portion.length === limit &&
      portion.every((path) => pass.examinedPaths?.includes(path))
    )
      limit = Math.min(bounds.paths, limit * 2);
  }
  recordUnresolved(context, task, stuck);
  if (task.status === "cancelled") {
    task.limitations.push(`Unexamined aspect: ${control.stopReason}.`);
    persist();
  }
}

function recordUnresolved(
  context: OwnerContext,
  task: RunTask,
  stuck: ReadonlySet<string>,
) {
  const { input, control } = context;
  const { stopped, persist } = control;
  if (resolved(task)) {
    delete task.unresolved;
    return;
  }
  const paths = uncovered(input, task.result?.examinedPaths ?? []);
  task.unresolved = {
    cause:
      task.attempts.at(-1)?.failure ||
      (stuck.size
        ? "no-progress"
        : stopped()
          ? control.stopReason
          : "declared-unresolved"),
    paths,
    ...(stuck.size ? { stuck: [...stuck] } : {}),
  };
  if (stuck.size)
    task.limitations.push(
      `No progress on ${stuck.size} assessed path(s) even alone: ${[...stuck].slice(0, 5).join(", ")}${stuck.size > 5 ? ", ..." : ""}.`,
    );
  persist();
}
