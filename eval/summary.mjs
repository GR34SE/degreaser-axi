const fixed = (value) => (Number.isFinite(value) ? value.toFixed(2) : "n/a");

const table = (header, rows) =>
  [header, header.map(() => "---"), ...rows]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");

export function renderSummary(report) {
  const families = table(
    [
      "Family",
      "Split",
      "Aspects",
      "Samples",
      "REPORT/PRESERVE anchors",
      "Recall",
      "Recall primary",
      "Preserve violation",
      "Complete",
    ],
    report.breakdown.map((row) => [
      row.family,
      row.split ?? "n/a",
      row.aspects.join(", "),
      row.samples,
      `${row.reportAnchors}/${row.preserveAnchors}`,
      fixed(row.recall),
      fixed(row.recallPrimary),
      fixed(row.preserveViolationRate),
      fixed(row.completeness),
    ]),
  );
  const misses = report.systematicMisses.length
    ? report.systematicMisses
        .map(
          (miss) =>
            `- ${miss.sampleId} ${miss.anchorId}: missed in ${miss.missedRepeats} repeats`,
        )
        .join("\n")
    : "- None missed in two or more repeats.";
  const factors = Object.entries(report.missFactors).map(
    ([name, buckets]) =>
      `### ${name}\n\n${table(
        ["Bucket", "Anchors", "Hit rate"],
        Object.entries(buckets).map(([bucket, value]) => [
          bucket,
          value.anchors,
          fixed(value.hitRate),
        ]),
      )}`,
  );
  const diagnosis = report.diagnosis.length
    ? report.diagnosis
        .map(
          (item) => `- ${item.signal} = ${fixed(item.value)}: ${item.suggests}`,
        )
        .join("\n")
    : "- No signal met its threshold.";
  return `${[
    "# Evaluation summary",
    `Records: ${report.records}. Provider errors: ${report.providerErrors}. Incomplete records: ${report.incompleteRecords}.`,
    `## Families\n\n${families}`,
    `## Systematic misses\n\n${misses}`,
    `## Miss factors\n\nHit rate over REPORT anchors of complete records.\n\n${factors.join("\n\n")}`,
    `## Diagnosis\n\nHeuristics for choosing where to look next, not proof of cause.\n\n${diagnosis}`,
  ].join("\n\n")}\n`;
}
