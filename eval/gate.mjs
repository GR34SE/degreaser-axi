import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { pairRuns } from "./gate-pairs.mjs";
import { compareMetric, METRICS } from "./gate-statistics.mjs";

export function compareRuns(baseline, candidate, options = {}) {
  const requestedMode = options.mode ?? "non-regression";
  const mode = ["non-regression", "improvement"].includes(requestedMode)
    ? requestedMode
    : "invalid";
  const { pairs, issues, excludedRows } = pairRuns(baseline, candidate);
  if (!["non-regression", "improvement"].includes(mode))
    issues.push({ code: "unsupported-mode" });
  if (options.metrics !== undefined)
    issues.push({ code: "unsupported-metric-override" });
  const grouped = new Map();
  for (const pair of pairs) {
    if (!grouped.has(pair.family)) grouped.set(pair.family, []);
    grouped.get(pair.family).push(pair);
  }
  const families = [...grouped]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, rows]) => {
      const metrics = Object.fromEntries(
        Object.keys(METRICS).map((metric) => [
          metric,
          compareMetric(rows, metric, family),
        ]),
      );
      const newForbidden = rows.flatMap((pair) =>
        pair.candidate.score.forbiddenHits
          .filter((id) => !pair.baseline.score.forbiddenHits.includes(id))
          .map(() => ({ sampleKey: pair.sampleKey, repeat: pair.repeat })),
      );
      const unsupportedMetrics = Object.entries(metrics)
        .filter(([, m]) => m.status === "unsupported" && m.notApplicable)
        .map(([name]) => name);
      const singleSource = Object.values(metrics).some(
        (m) => m.unit === "sample" && m.interval95 !== null,
      );
      return {
        family,
        pairs: rows.length,
        evidenceScope: singleSource ? "single-source" : "multi-source",
        unsupportedMetrics,
        metrics,
        newForbiddenSentinels: newForbidden.length,
        forbiddenRows: newForbidden,
        pass:
          !newForbidden.length &&
          metrics.recall?.status !== "unsupported" &&
          Object.values(metrics).every(
            (m) => m.pass || (m.status === "unsupported" && m.notApplicable),
          ),
      };
    });
  const improved = families.some((family) =>
    Object.values(family.metrics).some((metric) => metric.improved),
  );
  const nonRegression =
    families.length > 0 && families.every((family) => family.pass);
  const pass =
    !issues.length && nonRegression && (mode !== "improvement" || improved);
  const regressed = families.some(
    (family) =>
      family.newForbiddenSentinels ||
      Object.values(family.metrics).some(
        (metric) => metric.status === "regressed",
      ),
  );
  return {
    schemaVersion: 1,
    pass,
    runIdentities: Object.fromEntries(
      ["baseline", "candidate"].map((side) => {
        const meta = pairs[0]?.[side].envelope.meta;
        return [
          side,
          meta
            ? {
                agent: meta.agent,
                model: meta.model,
                productSha: meta.productSha,
                productHash: meta.productHash ?? null,
              }
            : null,
        ];
      }),
    ),
    status: issues.length
      ? "invalid"
      : pass
        ? "passed"
        : regressed
          ? "regressed"
          : nonRegression && !improved
            ? "not-improved"
            : "inconclusive",
    mode,
    improved: !issues.length && nonRegression && improved,
    evidenceScope: families.some((f) => f.evidenceScope === "single-source")
      ? "single-source"
      : "multi-source",
    pairedRows: pairs.length,
    excludedRows,
    issues,
    families,
    pairedRecallDeltas: pairs.map((pair) => ({
      sampleKey: pair.sampleKey,
      clusterKey: pair.cluster,
      family: pair.family,
      repeat: pair.repeat,
      baseline: pair.baseline.score.recall,
      candidate: pair.candidate.score.recall,
      delta:
        pair.baseline.score.recall === null ||
        pair.candidate.score.recall === null
          ? null
          : pair.candidate.score.recall - pair.baseline.score.recall,
    })),
    method: {
      name: "paired-percentile-bootstrap",
      resamples: 10000,
      interval: 0.95,
      minimumClusters: 2,
      minimumSamplesSingleCluster: 8,
      aggregation:
        "repeat -> sample -> source cluster -> family; one source cluster resamples samples",
      notes: [
        "Intervals bound paired differences, never absolute candidate scores.",
        "Precision proxy and lexical sentinels do not establish semantic correctness or harm.",
        "A family spanning two or more source clusters resamples cluster means; a family from exactly one source cluster resamples samples (each the mean of its repeats) when it has at least 8, otherwise it is inconclusive.",
        "A single-source verdict supports a claim about that source repository only, not about other codebases.",
        "A metric with no defined value on either side in any pair is unsupported and not applicable to the family verdict; unsupported recall, one-sided absence and incomplete reviews never pass.",
        "A partial review counts as completeness 0 and leaves its anchor metrics inconclusive.",
        "Preserve-rate margin -0.03 is equivalent to preserve-violation margin +0.03.",
      ],
    },
  };
}

function parseRecords(source) {
  try {
    return JSON.parse(source);
  } catch {
    const lines = source.split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) return [];
    return lines.map((line) => JSON.parse(line));
  }
}

// This development entry point emits a fixed JSON artifact, not the product's
// SDK-routed interactive CLI, errors, help, hooks or output surfaces.
async function main() {
  try {
    const { values } = parseArgs({
      options: {
        baseline: { type: "string" },
        candidate: { type: "string" },
        output: { type: "string" },
        mode: { type: "string" },
      },
    });
    if (!values.baseline || !values.candidate) throw new Error("arguments");
    const [baseline, candidate] = await Promise.all(
      [values.baseline, values.candidate].map(async (file) =>
        parseRecords(await readFile(file, "utf8")),
      ),
    );
    const report = compareRuns(baseline, candidate, {
      mode: values.mode ?? "non-regression",
    });
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (values.output) await writeFile(values.output, output, { mode: 0o600 });
    process.stdout.write(output);
    process.exitCode = report.pass ? 0 : 1;
  } catch {
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: 1,
        pass: false,
        status: "invalid",
        issues: [{ code: "invalid-arguments-or-input-file" }],
      })}\n`,
    );
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
