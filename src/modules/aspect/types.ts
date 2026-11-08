export interface AspectMeta {
  id: string;
  title: string;
  summary: string;
  applicability: "paths" | "task";
  boundaries: readonly { other: string; rule: string; reciprocal: boolean }[];
}

export interface Aspect {
  meta: AspectMeta;
  rubric: URL;
}
