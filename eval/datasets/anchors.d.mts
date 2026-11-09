export function uniqueSnippetRange(
  source: string,
  snippet: string,
): [number, number] | null;
export function stripLocalization(
  tagged: string,
  raw: string,
  tag?: string,
): [number, number][] | null;
export function mergeRanges(ranges: [number, number][]): [number, number][];
export function oldDiffRanges(patch: string): [number, number][];
export function comments(
  source: string,
): { text: string; start: number; end: number; kind: number }[];
export function commentLabels(
  before: string,
  after: string,
  changedRanges: [number, number][],
  path: string,
): {
  report: import("./derive.mjs").Label[];
  preserve: [];
  forbidden: [];
};
