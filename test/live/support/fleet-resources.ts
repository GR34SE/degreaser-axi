import { spawnSync } from "node:child_process";
import { closeSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { loadavg, totalmem } from "node:os";
import { setTimeout } from "node:timers/promises";
import type { ProcessIdentity } from "../../../src/state/run.ts";

export function localRead(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });
  if (result.status !== 0)
    throw new Error(`Measurement unavailable: ${command}`);
  return result.stdout;
}

export function parseMemory(vm: string, pressure: string, swap: string) {
  const number = (text: string, pattern: RegExp) => {
    const match = pattern.exec(text);
    if (!match) throw new Error("Unrecognized memory measurement");
    return Number(match[1]);
  };
  const page = number(vm, /page size of (\d+) bytes/);
  const pages = (name: string) =>
    number(vm, new RegExp(`${name}:\\s+(\\d+)\\.`));
  const level = number(pressure.trim(), /^([124])$/);
  return {
    headroomBytes:
      (pages("Pages free") +
        pages("Pages inactive") +
        pages("Pages speculative")) *
      page,
    compressorBytes: pages("Pages occupied by compressor") * page,
    swapBytes: number(swap, /used\s*=\s*([\d.]+)M/) * 1024 ** 2,
    pressure: level,
  };
}
export type Memory = ReturnType<typeof parseMemory>;
export function unsafeMemory(baseline: Memory, current: Memory) {
  return (
    current.pressure !== 1 ||
    current.headroomBytes < baseline.headroomBytes * 0.3
  );
}
export function sampleMemory() {
  return {
    time: Date.now(),
    ...parseMemory(
      localRead("/usr/bin/vm_stat", []),
      localRead("/usr/sbin/sysctl", [
        "-n",
        "kern.memorystatus_vm_pressure_level",
      ]),
      localRead("/usr/sbin/sysctl", ["-n", "vm.swapusage"]),
    ),
    totalBytes: totalmem(),
    load: loadavg(),
  };
}

export interface FleetProcess extends ProcessIdentity {
  parent: number;
  cpu: number;
}
export function processes(): FleetProcess[] {
  return localRead("/bin/ps", ["-axo", "pid=,ppid=,pgid=,lstart=,stat=,%cpu="])
    .trim()
    .split("\n")
    .flatMap((line) => {
      const f = line.trim().split(/\s+/);
      if (f.length !== 10) throw new Error("Unrecognized process measurement");
      return f[8]?.startsWith("Z")
        ? []
        : [
            {
              pid: Number(f[0]),
              parent: Number(f[1]),
              group: Number(f[2]),
              started: f.slice(3, 8).join(" "),
              cpu: Number(f[9]),
            },
          ];
    });
}
export function sameProcess(a: ProcessIdentity, b: ProcessIdentity) {
  return a.pid === b.pid && a.group === b.group && a.started === b.started;
}
export function collectOwned(
  rows: FleetProcess[],
  owner: ProcessIdentity,
  known: ProcessIdentity[],
) {
  const owned = rows.filter(
    (row) => sameProcess(row, owner) || known.some((p) => sameProcess(row, p)),
  );
  for (;;) {
    const additions = rows.filter(
      (row) => !owned.includes(row) && owned.some((p) => p.pid === row.parent),
    );
    if (!additions.length) return owned;
    owned.push(...additions);
  }
}
export function otherLiveWork() {
  // Inspect commands in memory, emit only PIDs, never unrelated argv.
  return liveProcessIds(
    localRead("/bin/ps", ["-axo", "pid=,command="]),
    process.pid,
  );
}
export function liveProcessIds(table: string, self: number) {
  return table
    .split("\n")
    .filter((line) =>
      /(?:review\/owner\/process\.js|test\/live\/(?:run|support\/live-(?:caller|native|review|fleet))\.(?:ts|js)|\/(?:codex-acp|claude-agent-acp|pi-acp)(?:\/| ))/.test(
        line,
      ),
    )
    .map((line) => Number(line.trim().split(/\s+/)[0]))
    .filter((pid) => pid !== self);
}
export function fleetLock(path: string) {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, `${process.pid}\n`);
  } finally {
    closeSync(fd);
  }
  return () => unlinkSync(path);
}

export function selectedQuota(
  entries: {
    scope?: string;
    status?: string;
    effectivePercentRemaining?: number;
  }[],
  model: string,
) {
  const applicable = entries.filter(
    (e) =>
      e.scope === "all_models" ||
      (e.scope?.startsWith("model:") && model.includes(e.scope.slice(6))),
  );
  if (
    !applicable.some((e) => e.scope === "all_models") ||
    entries.some(
      (e) => e.scope !== "all_models" && !e.scope?.startsWith("model:"),
    ) ||
    applicable.some(
      (e) =>
        e.status !== "known" ||
        !Number.isFinite(e.effectivePercentRemaining) ||
        (e.effectivePercentRemaining ?? 0) <= 0 ||
        (e.effectivePercentRemaining ?? 0) > 100,
    )
  )
    throw new Error("Quota unavailable or model applicability unknown");
  return Math.min(...applicable.map((e) => e.effectivePercentRemaining ?? 0));
}

export async function monitorFleet(
  actions: {
    sample: () => void;
    stopRequested: () => boolean;
    cancel: () => Promise<unknown> | undefined;
    onFailure: (stage: string) => void;
  },
  signal: AbortSignal,
  intervalMs = 1000,
) {
  let cancellation: Promise<void> | undefined;
  try {
    while (!signal.aborted) {
      try {
        actions.sample();
      } catch {
        actions.onFailure("Resource monitor failed");
      }
      if (actions.stopRequested() && !cancellation)
        cancellation = Promise.resolve()
          .then(actions.cancel)
          .then(
            () => {},
            () => actions.onFailure("Owned cancellation failed"),
          )
          .finally(() => {
            cancellation = undefined;
          });
      try {
        await setTimeout(intervalMs, undefined, { signal });
      } catch (error) {
        if (!signal.aborted) throw error;
      }
    }
  } finally {
    await cancellation;
  }
}
