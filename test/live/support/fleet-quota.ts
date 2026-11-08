import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { selectedQuota } from "./fleet-resources.ts";

export function quota(agent: string, model: string) {
  const result = spawnSync(
    "quota-axi",
    [
      "--provider",
      agent,
      "--no-credential-refresh",
      "--max-age",
      "0",
      "--json",
    ],
    {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, QUOTA_AXI_SNAPSHOT: "", QUOTA_AXI_MAX_AGE: "0" },
    },
  );
  assert.equal(result.status, 0, "Fresh quota check failed");
  const data = JSON.parse(result.stdout);
  const provider = data.providers.find(
    (p: { provider: string }) => p.provider === agent,
  );
  assert.ok(
    provider?.state.status === "fresh" && !provider.state.stale,
    "Quota is not fresh",
  );
  const windows = provider.windows.map(
    (w: { id: string; percentRemaining: number; resetsAt: string }) => ({
      id: w.id,
      percentRemaining: w.percentRemaining,
      resetsAt: w.resetsAt,
    }),
  );
  const remaining = selectedQuota(
    provider.quotaSemantics?.effectiveAvailability ?? [],
    model,
  );
  assert.ok(
    Math.abs(Date.now() - Date.parse(data.generatedAt)) < 120_000,
    "Quota timestamp is not fresh",
  );
  return {
    generatedAt: data.generatedAt,
    provider: agent,
    selectedPercentRemaining: remaining,
    windows,
  };
}
