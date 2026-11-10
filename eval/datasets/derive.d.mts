export interface Label {
  id: string;
  path: string;
  lines: [number, number];
  aspects?: string[];
  labelKind?: string;
}
export interface Sample {
  id: string;
  family: string;
  cluster: string;
  split: "dev" | "regression" | "holdout";
  labelKind: string;
  aspects: string[];
  repo: { directory: string };
  review: {
    scope: "repository" | "branch";
    paths: string[];
    task: string;
    base?: string;
  };
  target: {
    report: Label[];
    preserve: Label[];
    forbidden: { id: string; pattern: string; path?: string }[];
  };
  provenance: Record<string, unknown>;
  contrast?: { group: string; overlay: string; scope: string };
}
export function deriveDatasets(options: {
  sourceRoot?: string;
  outputDir: string;
  selfRepo?: string;
  sources?: string[];
  contrasts?: boolean;
  selfRevisions?: { before: string; after: string };
}): Promise<{ samples: Sample[]; receipt: Record<string, unknown> }>;
export function splitForCluster(cluster: string): Sample["split"];
