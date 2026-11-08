import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { processCommands } from "../../src/util/exec/process-table.ts";

export async function cleanupRuns({
  repo,
  runDir,
  external,
  lifecycleLog,
  node,
  cli,
  environment,
  temp,
}) {
  const deadline = Date.now() + 20_000;
  const cancelled = new Set();
  const ownerMarker = ` ${join(dirname(cli), "review/owner/process.js")} `;
  const adapter = join(external, "review-acp.mjs");
  const canonicalRepo = existsSync(repo) ? realpathSync(repo) : repo;
  for (;;) {
    let rows;
    try {
      rows = processCommands({ timeout: 3_000 });
    } catch (error) {
      throw new Error(`Cannot inspect QA processes; retained ${temp}`, {
        cause: error,
      });
    }
    const owners = rows.filter(
      (row) =>
        row.command.includes(ownerMarker) &&
        row.command.includes(` ${canonicalRepo} `),
    );
    const recorded = existsSync(lifecycleLog)
      ? new Set(
          readFileSync(lifecycleLog, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line).pid),
        )
      : new Set();
    const adapters = rows.filter(
      (row) =>
        row.command.includes(adapter) &&
        (recorded.has(row.pid) ||
          row.command.includes(join(external, "plan.json"))),
    );
    if (owners.length === 0 && adapters.length === 0) return;
    if (Date.now() >= deadline)
      throw new Error(
        `QA processes did not exit; retained ${temp}; owners=${owners.map((r) => r.pid)}, adapters=${adapters.map((r) => r.pid)}`,
      );
    if (existsSync(runDir)) {
      for (const id of readdirSync(runDir)) {
        if (
          !owners.some((row) =>
            row.command.endsWith(` ${canonicalRepo} ${id}`),
          ) ||
          cancelled.has(id)
        )
          continue;
        cancelled.add(id);
        spawnSync(node, [cli, "cancel", id], {
          cwd: repo,
          env: environment,
          encoding: "utf8",
          timeout: 5_000,
        });
      }
    }
    await delay(100);
  }
}
