const fixed = (value, digits = 2) =>
  Number.isFinite(value) ? value.toFixed(digits) : "n/a";

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
      "Precision proxy",
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
      fixed(row.precisionProxy),
      fixed(row.preserveViolationRate),
      fixed(row.completeness),
    ]),
  );
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
    `## Miss factors\n\nHit rate over REPORT anchors of complete records.\n\n${factors.join("\n\n")}`,
    `## Diagnosis\n\n${report.diagnosisNote}\n\n${diagnosis}`,
  ].join("\n\n")}\n`;
}
