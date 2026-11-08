import { isDeepStrictEqual } from "node:util";
import {
  computeSessionStartHookRemoval,
  computeSessionStartHookUpdate,
  type HookGroup,
} from "axi-sdk-js";
import { type Agent, HARNESSES } from "../modules/harness/api.ts";
import type { Runtime } from "../util/exec/types.ts";
import { hash } from "../util/hash.ts";
import { json } from "../util/json.ts";
import {
  HOOK_MARKER,
  hookSpec,
  withCurrentExecutable,
} from "./hook-command.ts";
import type { Receipt } from "./receipt.ts";
import { hookFormat, isMarked } from "./targets.ts";
import { conflict, type IntegrationEdits, parseObject } from "./transaction.ts";

function withGroups(
  settings: Record<string, unknown>,
  events: Record<string, unknown>,
  event: string,
  groups: unknown[],
) {
  const { [event]: _, ...rest } = events;
  const hooks = groups.length ? { ...events, [event]: groups } : rest;
  if (Object.keys(hooks).length) return { ...settings, hooks };
  const { hooks: __, ...other } = settings;
  return other;
}

export function updateHook(
  runtime: Runtime,
  edits: IntegrationEdits,
  receipt: Receipt,
  agent: Agent,
  path: string,
  remove: boolean,
) {
  const format = hookFormat(runtime, agent);
  // The SDK edits nested SessionStart, not Cursor's flat sessionStart.
  const cursor = HARNESSES[agent].integration.hook.kind === "flat";
  const text = edits.read(path);
  const settings = parseObject(text ?? "{}", path);
  if (
    format.version !== undefined &&
    settings.version !== undefined &&
    settings.version !== format.version
  )
    conflict(path);
  const hooks = settings.hooks === undefined ? {} : settings.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks))
    conflict(path);
  const events = hooks as Record<string, unknown>;
  const groups = events[format.event] ?? [];
  if (
    !Array.isArray(groups) ||
    groups.some((group) => format.commands(group) === null)
  )
    conflict(path);
  const previous = receipt.hooks[agent];
  if (previous && previous.path !== path) conflict(path);
  const marked = groups.filter((group) => isMarked(format, group));
  const generated = cursor
    ? { command: format.command }
    : (
        computeSessionStartHookUpdate({}, hookSpec(runtime))[0].hooks as Record<
          string,
          unknown[]
        >
      )[format.event]?.[0];
  const matches = previous
    ? groups.filter((group) => isDeepStrictEqual(group, previous.group))
    : marked.length === 1 &&
        (!remove ||
          isDeepStrictEqual(
            JSON.parse(JSON.stringify(marked[0]), (key, value) =>
              key === "command" && typeof value === "string"
                ? withCurrentExecutable(runtime, value)
                : value,
            ),
            generated,
          ))
      ? marked
      : [];
  if (matches.length > 1 || marked.some((group) => !matches.includes(group)))
    conflict(path);
  const remaining = groups.filter((group) => !matches.includes(group));
  const others = remaining.map((group) => hash(JSON.stringify(group)));
  if (
    previous &&
    !matches.length &&
    others.some((digest) => !previous.others.includes(digest))
  )
    conflict(path);
  if (remove) {
    delete receipt.hooks[agent];
    if (!matches.length) return;
    const cleaned = cursor
      ? withGroups(settings, events, format.event, remaining)
      : computeSessionStartHookRemoval(settings, HOOK_MARKER)[0];
    const leftover = Object.keys(cleaned).filter(
      (key) => !cursor || key !== "version",
    );
    edits.set(
      path,
      (previous?.created ?? true) && leftover.length === 0
        ? null
        : json(cleaned),
    );
    return;
  }
  const [updated, changed] = cursor
    ? [
        withGroups(
          { version: format.version, ...settings },
          events,
          format.event,
          [...remaining, { command: format.command }],
        ),
        !(
          matches.length === 1 &&
          isDeepStrictEqual(previous?.group, { command: format.command })
        ),
      ]
    : computeSessionStartHookUpdate(settings, hookSpec(runtime));
  const group = (updated.hooks as Record<string, unknown[]> | undefined)?.[
    format.event
  ]?.find((g) => isMarked(format, g));
  receipt.hooks[agent] = {
    path,
    group: (group ?? {}) as HookGroup | { command: string },
    created: previous?.created ?? text === null,
    others,
  };
  if (changed) edits.set(path, json(updated));
}
