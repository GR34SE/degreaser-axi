import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCleanup } from "./cleanup.mjs";
import {
  assertRealPath,
  materialize,
  ordered,
  SourceReader,
  sha256,
} from "./io.mjs";
import { loadPairs, REFACTOR_TYPES } from "./pairs.mjs";
import { loadSelf } from "./self.mjs";

const CHECKOUT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCES = ["self", "swe-refactor", "simplibench", "cleanup-pr"];

export function splitForCluster(cluster) {
  if (cluster === "repository:degreaser-axi") return "dev";
  if (cluster === "population:simplibench-small-test") return "holdout";
  const bucket =
    Number.parseInt(sha256(`degreaser-eval-v1:${cluster}`).slice(0, 8), 16) %
    10;
  return bucket < 6 ? "dev" : bucket < 8 ? "regression" : "holdout";
}

export async function deriveDatasets({
  sourceRoot,
  outputDir,
  selfRepo = CHECKOUT,
  sources = SOURCES,
  contrasts = false,
} = {}) {
  if (typeof sourceRoot !== "string" || typeof outputDir !== "string") {
    throw new Error("sourceRoot and outputDir are required");
  }
  if (
    !Array.isArray(sources) ||
    !sources.length ||
    new Set(sources).size !== sources.length ||
    sources.some((source) => !SOURCES.includes(source))
  )
    throw new Error("Invalid dataset sources");
  const reader = new SourceReader(sourceRoot);
  const destination = resolve(outputDir);
  assertRealPath(dirname(destination));
  if (existsSync(destination))
    throw new Error("outputDir must be a new directory");
  // Never write a generated derivative underneath downloaded evidence.
  if (
    destination === reader.root ||
    destination.startsWith(`${reader.root}/`)
  ) {
    throw new Error("outputDir must be outside sourceRoot");
  }
  mkdirSync(destination);
  const records = [];
  const skipped = [];
  const counts = {};
  const skip = (source, record, reason) =>
    skipped.push({ source, record, reason });
  const accept = (record) => records.push(record);
  loadPairs(reader, sources, accept, skip, counts);
  const gitSources = sources.includes("self")
    ? [
        loadSelf(
          assertRealPath(selfRepo),
          destination,
          accept,
          skip,
          counts,
          contrasts,
        ),
      ]
    : [];
  if (sources.includes("cleanup-pr"))
    loadCleanup(reader, destination, accept, skip, counts);
  const ids = new Set();
  const samples = records
    .map((record) => {
      if (ids.has(record.id))
        throw new Error(`Duplicate sample ID: ${record.id}`);
      ids.add(record.id);
      const repo =
        record.repo ??
        materialize(
          join(destination, "repos", sha256(record.id).slice(0, 24)),
          record.files,
        );
      return {
        id: record.id,
        family: record.family,
        cluster: record.cluster,
        split: splitForCluster(record.cluster),
        labelKind: record.labelKind,
        aspects: record.aspects,
        repo: { directory: repo.directory },
        review: {
          scope: "repository",
          task: "Audit the selected source for unjustified complexity and maintainability problems. Do not assume that a refactoring is necessary.",
          ...record.review,
          paths: record.paths,
        },
        target: record.target,
        ...(record.contrast ? { contrast: record.contrast } : {}),
        provenance: {
          ...record.provenance,
          materializedHead: repo.head,
          sourceFilesSha256: record.files
            ? sha256(
                [...record.files]
                  .map(([path, content]) => `${path}\0${sha256(content)}`)
                  .join("\n"),
              )
            : undefined,
        },
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const jsonl =
    samples.map((sample) => JSON.stringify(sample)).join("\n") +
    (samples.length ? "\n" : "");
  writeFileSync(join(destination, "samples.jsonl"), jsonl, { flag: "wx" });
  const inputs = [...reader.files.values()].sort((a, b) =>
    a.path < b.path ? -1 : 1,
  );
  const byReason = {};
  skipped.forEach(({ source, reason }) => {
    const key = `${source}:${reason}`;
    byReason[key] = (byReason[key] ?? 0) + 1;
  });
  const receipt = {
    schemaVersion: 1,
    algorithm: "source-backed-v2",
    sources,
    contrasts,
    sourceFiles: inputs,
    gitSources,
    sourceManifestSha256: sha256(JSON.stringify({ files: inputs, gitSources })),
    mappingSha256: sha256(JSON.stringify(REFACTOR_TYPES)),
    rawCounts: counts,
    samples: samples.length,
    samplesSha256: sha256(jsonl),
    // Portable identity excludes only generated absolute repo paths.
    portableSamplesSha256: sha256(
      JSON.stringify(
        samples.map((sample) => ({
          ...sample,
          repo: {
            directory: `<generated>/${relative(join(destination, "repos"), sample.repo.directory)}`,
          },
        })),
      ),
    ),
    byFamily: Object.fromEntries(
      ordered(new Set(samples.map((sample) => sample.family))).map((family) => [
        family,
        samples.filter((sample) => sample.family === family).length,
      ]),
    ),
    skippedByReason: byReason,
    skipped,
    limitations: [
      "Change proxies are accepted transformations, not verified defects; unmatched findings are proxy measurements.",
      "Surviving comments and untouched code remain unknown; these derivatives supply no PRESERVE labels.",
      "SimpliBench has no repository identity here: its entire population is holdout; raw one-line anchors are coarse.",
      "Source-only snapshots omit runtime context; no third-party code, models, tests or build commands were executed.",
      "PR comparisons are API base/head snapshot proxies, not verified merge-base comparisons.",
    ],
  };
  writeFileSync(
    join(destination, "receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { flag: "wx" },
  );
  return { samples, receipt };
}
