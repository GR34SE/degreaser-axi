import { createHash } from "node:crypto";
import { scoreSample } from "./assert/anchor-match.mjs";
import { object, text } from "./assert/validation.mjs";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!object(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}
export const hash = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

function inputHash(sample) {
  const { directory, ...repo } = sample.repo ?? {};
  return hash({ ...sample, repo });
}

function sourceCluster(sample) {
  const provenance = sample.provenance;
  // A dataset may explicitly group related commits/templates. Without that,
  // all slices of one source revision stay together, never one cluster/repeat.
  return hash([
    provenance.source,
    sample.cluster ??
      provenance.cluster ??
      provenance.group ??
      sample.group ??
      provenance.revision,
  ]);
}

export function pairRuns(baselineInput, candidateInput) {
  const issues = [],
    excludedRows = [],
    maps = [];
  for (const [side, input] of [
    ["baseline", baselineInput],
    ["candidate", candidateInput],
  ]) {
    const rows = Array.isArray(input) ? input : input?.records;
    const map = new Map();
    maps.push(map);
    if (!Array.isArray(rows) || !rows.length) {
      issues.push({ code: "no-records", side });
      continue;
    }
    let identity;
    const repeatSets = new Map();
    for (const [index, row] of rows.entries()) {
      const reject = (code) => {
        const issue = { code, side, row: index };
        issues.push(issue);
        excludedRows.push(issue);
      };
      if (
        !object(row) ||
        row.error ||
        !Number.isSafeInteger(row.repeat) ||
        row.repeat < 0
      ) {
        reject("invalid-record");
        continue;
      }
      const { sample, envelope } = row;
      const score = scoreSample(sample, envelope);
      if (!score.complete) {
        reject("incomplete-or-invalid-export");
        continue;
      }
      const meta = envelope?.meta;
      if (
        !object(sample.provenance) ||
        !text(sample.provenance.source) ||
        !text(sample.provenance.revision) ||
        !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(sample.family)
      ) {
        reject("invalid-identity-or-metrics");
        continue;
      }
      const currentIdentity = hash([
        meta.agent,
        meta.model,
        meta.productSha,
        meta.productHash ?? null,
      ]);
      identity ??= currentIdentity;
      if (currentIdentity !== identity) {
        reject("mixed-run-identity");
        continue;
      }
      const key = JSON.stringify([sample.id, row.repeat]);
      if (map.has(key)) {
        reject("duplicate-record");
        continue;
      }
      const sampleKey = hash(sample.id);
      const cluster = sourceCluster(sample);
      map.set(key, {
        ...row,
        score,
        inputHash: inputHash(sample),
        sampleKey,
        cluster,
      });
      if (!repeatSets.has(sample.id)) repeatSets.set(sample.id, []);
      repeatSets.get(sample.id).push(row.repeat);
    }
    const signatures = [...repeatSets.values()].map((set) =>
      JSON.stringify(set.sort((a, b) => a - b)),
    );
    if (new Set(signatures).size > 1)
      issues.push({ code: "inconsistent-repetition-sets", side });
  }
  const [baseline, candidate] = maps;
  const pairs = [];
  for (const key of new Set([...baseline.keys(), ...candidate.keys()])) {
    const b = baseline.get(key),
      c = candidate.get(key);
    const sampleKey = (b ?? c).sampleKey;
    if (!b || !c) {
      const issue = {
        code: "missing-pair",
        sampleKey,
        repeat: (b ?? c).repeat,
      };
      issues.push(issue);
      excludedRows.push(issue);
      continue;
    }
    if (
      b.inputHash !== c.inputHash ||
      b.envelope.meta.sampleHash !== c.envelope.meta.sampleHash ||
      b.envelope.meta.agent !== c.envelope.meta.agent ||
      b.envelope.meta.model !== c.envelope.meta.model
    ) {
      const issue = {
        code: "mismatched-pair-input-or-model",
        sampleKey,
        repeat: b.repeat,
      };
      issues.push(issue);
      excludedRows.push(issue);
      continue;
    }
    pairs.push({
      baseline: b,
      candidate: c,
      sampleKey,
      cluster: b.cluster,
      family: b.sample.family,
      repeat: b.repeat,
    });
  }
  // Same ID must not silently refer to different input on different repeats.
  for (const map of maps) {
    const identities = new Map();
    for (const row of map.values()) {
      const identity = hash([row.inputHash, row.envelope.meta.sampleHash]);
      if (
        identities.has(row.sampleKey) &&
        identities.get(row.sampleKey) !== identity
      )
        issues.push({ code: "mixed-sample-input", sampleKey: row.sampleKey });
      identities.set(row.sampleKey, identity);
    }
  }
  pairs.sort(
    (a, b) => a.sampleKey.localeCompare(b.sampleKey) || a.repeat - b.repeat,
  );
  return { pairs, issues, excludedRows };
}
