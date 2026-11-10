import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Anchor, Sample } from "./dataset.ts";
import type { ReviewRecord } from "./review.ts";

type Scored = Extract<ReviewRecord, { outcome: "complete" }>;
interface Entry {
  sample: Sample;
  records: ReviewRecord[];
  scored: Scored[];
}

const FACTORS = {
  "review size": ["1 file", "2-5 files", "6+ files", "whole repository"],
  "file length": ["<=150", "151-400", ">400"],
  position: ["top", "middle", "bottom"],
  "label length": ["1", "2-4", "5+"],
};
const DROPS = [
  ["review size", "1 file", "6+ files"],
  ["review size", "1 file", "whole repository"],
  ["file length", "<=150", ">400"],
] as const;

const mean = (values: number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
const known = (values: (number | null)[]) =>
  values.filter((value) => value !== null);
const sampleMean = (entries: Entry[], value: (entry: Entry) => number | null) =>
  mean(known(entries.map(value)));
const metric = (
  entries: Entry[],
  key: "recall" | "recallPrimary" | "retention",
) =>
  sampleMean(entries, ({ scored }) => mean(known(scored.map((r) => r[key]))));

function buckets(sample: Sample, anchor: Anchor, fileLines: number) {
  const paths = sample.paths.length;
  const [start, end] = anchor.lines;
  const position = (start - 1) / fileLines;
  const length = end - start + 1;
  return {
    "review size":
      paths === 0
        ? "whole repository"
        : paths === 1
          ? "1 file"
          : paths <= 5
            ? "2-5 files"
            : "6+ files",
    "file length":
      fileLines <= 150 ? "<=150" : fileLines <= 400 ? "151-400" : ">400",
    position: position < 1 / 3 ? "top" : position < 2 / 3 ? "middle" : "bottom",
    "label length": length === 1 ? "1" : length <= 4 ? "2-4" : "5+",
  };
}

function hitRates(entries: Entry[], repo: string) {
  const rates: Record<string, Record<string, number[]>> = Object.fromEntries(
    Object.entries(FACTORS).map(([factor, names]) => [
      factor,
      Object.fromEntries(names.map((name) => [name, []])),
    ]),
  );
  const fileLines = new Map<string, number>();
  for (const { sample, scored } of entries) {
    if (!scored.length) continue;
    for (const anchor of sample.report) {
      const lines =
        fileLines.get(anchor.path) ??
        readFileSync(join(repo, anchor.path), "utf8")
          .replace(/\n$/, "")
          .split("\n").length;
      fileLines.set(anchor.path, lines);
      const rate = mean(
        scored.map((record) => Number(record.hits.includes(anchor.id))),
      );
      for (const [factor, bucket] of Object.entries(
        buckets(sample, anchor, lines),
      ))
        rates[factor]?.[bucket]?.push(rate ?? 0);
    }
  }
  return Object.fromEntries(
    Object.entries(rates).map(([factor, values]) => [
      factor,
      Object.fromEntries(
        Object.entries(values).map(([bucket, hits]) => [
          bucket,
          { anchors: hits.length, hitRate: mean(hits) },
        ]),
      ),
    ]),
  );
}

export function summarize(
  samples: Sample[],
  records: ReviewRecord[],
  repo: string,
) {
  const entries: Entry[] = samples
    .map((sample) => {
      const own = records.filter((record) => record.sample === sample.id);
      return {
        sample,
        records: own,
        scored: own.filter((record) => record.outcome === "complete"),
      };
    })
    .filter((entry) => entry.records.length);
  const groups = ["dev", "regression", "whole-repository"].flatMap((group) => {
    const members = entries.filter(
      ({ sample }) =>
        (sample.paths.length ? sample.split : "whole-repository") === group,
    );
    if (!members.length) return [];
    const anchors = (kind: "report" | "preserve") =>
      members.reduce((sum, { sample }) => sum + sample[kind].length, 0);
    return [
      {
        group,
        samples: members.length,
        reportAnchors: anchors("report"),
        preserveAnchors: anchors("preserve"),
        recall: metric(members, "recall"),
        recallPrimary: metric(members, "recallPrimary"),
        retention: metric(members, "retention"),
        completeness: sampleMean(members, (entry) => {
          const measured = entry.records.filter((r) => r.outcome !== "error");
          return measured.length ? entry.scored.length / measured.length : null;
        }),
      },
    ];
  });
  const rates = hitRates(entries, repo);
  const diagnosis: { signal: string; value: number; suggests: string }[] = [];
  for (const { group, recall, recallPrimary } of groups)
    if (
      recall !== null &&
      recallPrimary !== null &&
      recall - recallPrimary >= 0.1
    )
      diagnosis.push({
        signal: `evidence gap (${group})`,
        value: recall - recallPrimary,
        suggests: "the worker groups findings; this is not a detection failure",
      });
  for (const [factor, small, large] of DROPS) {
    const low = rates[factor]?.[small];
    const high = rates[factor]?.[large];
    if (
      low?.hitRate != null &&
      high?.hitRate != null &&
      low.anchors >= 5 &&
      high.anchors >= 5 &&
      low.hitRate - high.hitRate >= 0.15
    )
      diagnosis.push({
        signal: `hit rate drop (${factor}: ${small} to ${large})`,
        value: low.hitRate - high.hitRate,
        suggests:
          "misses grow with review size; look at coverage or budget, not rubric wording",
      });
  }
  const recall = metric(entries, "recall");
  if (!diagnosis.length && recall !== null && recall < 0.8)
    diagnosis.push({
      signal: "recall",
      value: recall,
      suggests:
        "no scoring or coverage signal explains the misses; review the rubric wording",
    });
  for (const { group, retention } of groups)
    if (retention !== null && retention < 0.9)
      diagnosis.push({
        signal: `kept comments flagged (${group})`,
        value: 1 - retention,
        suggests: "the rubric over-reports comments the owner kept",
      });
  return {
    records: records.length,
    errors: records.filter((record) => record.outcome === "error").length,
    incomplete: records.filter((record) => record.outcome === "incomplete")
      .length,
    groups,
    missedEveryTime: entries.flatMap(({ sample, scored }) =>
      scored.length
        ? sample.report
            .filter((anchor) =>
              scored.every((record) => !record.hits.includes(anchor.id)),
            )
            .map((anchor) => ({ sample: sample.id, anchor: anchor.id }))
        : [],
    ),
    hitRates: rates,
    diagnosis,
  };
}

const fixed = (value: number | null) =>
  value === null ? "n/a" : value.toFixed(2);
const table = (header: string[], rows: (string | number)[][]) =>
  [header, header.map(() => "---"), ...rows]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");

export function renderSummary(summary: ReturnType<typeof summarize>) {
  const groups = table(
    [
      "Group",
      "Samples",
      "REPORT/PRESERVE",
      "Recall",
      "Recall (primary)",
      "Retention",
      "Complete",
    ],
    summary.groups.map((row) => [
      row.group,
      row.samples,
      `${row.reportAnchors}/${row.preserveAnchors}`,
      fixed(row.recall),
      fixed(row.recallPrimary),
      fixed(row.retention),
      fixed(row.completeness),
    ]),
  );
  const missed = summary.missedEveryTime.length
    ? summary.missedEveryTime
        .map(({ sample, anchor }) => `- ${sample}: ${anchor}`)
        .join("\n")
    : "- None.";
  const rates = Object.entries(summary.hitRates).map(
    ([factor, buckets]) =>
      `### ${factor}\n\n${table(
        ["Bucket", "Anchors", "Hit rate"],
        Object.entries(buckets).map(([bucket, value]) => [
          bucket,
          value.anchors,
          fixed(value.hitRate),
        ]),
      )}`,
  );
  const diagnosis = summary.diagnosis.length
    ? summary.diagnosis
        .map((d) => `- ${d.signal} = ${fixed(d.value)}: ${d.suggests}`)
        .join("\n")
    : "- No signal met its threshold.";
  return `${[
    "# Evaluation summary",
    `Records: ${summary.records}. Errors: ${summary.errors}. Incomplete: ${summary.incomplete}.`,
    `## Groups\n\n${groups}`,
    `## Labels missed in every repetition\n\n${missed}`,
    `## Hit rate of REPORT labels\n\n${rates.join("\n\n")}`,
    `## Diagnosis\n\nHeuristics for where to look next, not proof of cause.\n\n${diagnosis}`,
  ].join("\n\n")}\n`;
}
