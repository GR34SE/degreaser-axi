import type { Finding } from "../../../src/review/ingest/types.ts";
import type { Anchor, Sample } from "./dataset.ts";

type Location = Finding["location"];
export interface Score {
  recall: number | null;
  recallPrimary: number | null;
  retention: number | null;
  hits: string[];
  preserveHits: string[];
}

const MAX_SPAN = 30;
const REFERENCE =
  /(?:^|[\s`"'([])([\w./@-]+):(?:(old|new):)?([1-9]\d*)(?:-([1-9]\d*))?(?=$|[\s`"'),;\]]|\.(?:$|\s))/g;
const RANGE = String.raw`(\d+)(?:\s*(?:-|–|—|to)\s*(\d+))?(?!\d)`;
const SEPARATOR = String.raw`(?:\s*,\s*and\s+|\s*,\s*|\s+and\s+|\s*&\s*)`;
const PROSE = new RegExp(
  String.raw`\blines?\s+${RANGE}(?:${SEPARATOR}${RANGE})*`,
  "gi",
);

function locations(finding: Finding): Location[] {
  const { location, evidence } = finding;
  const references = [...evidence.matchAll(REFERENCE)].map(
    ([, path = "", side, start = "", end = start]): Location => ({
      path,
      side: side === "old" || side === "new" ? side : location.side,
      startLine: Number(start),
      endLine: Number(end),
    }),
  );
  const prose = [...evidence.matchAll(PROSE)].flatMap(([list]) =>
    [...list.matchAll(new RegExp(RANGE, "g"))].map(
      ([, start = "", end = start]): Location => ({
        ...location,
        startLine: Number(start),
        endLine: Number(end),
      }),
    ),
  );
  return [location, ...references, ...prose];
}

const touches = (location: Location, anchor: Anchor) =>
  location.path === anchor.path &&
  location.side === "new" &&
  location.startLine <= location.endLine &&
  location.endLine - location.startLine < MAX_SPAN &&
  location.startLine <= anchor.lines[1] &&
  location.endLine >= anchor.lines[0];

export function score(
  sample: Pick<Sample, "report" | "preserve">,
  findings: Finding[],
): Score {
  const cited = findings.flatMap(locations);
  const primary = findings.map((finding) => finding.location);
  const hit = (anchors: Anchor[], located: Location[]) =>
    anchors
      .filter((anchor) => located.some((location) => touches(location, anchor)))
      .map((anchor) => anchor.id);
  const share = (count: number, total: number) =>
    total ? count / total : null;
  const hits = hit(sample.report, cited);
  const preserveHits = hit(sample.preserve, cited);
  return {
    recall: share(hits.length, sample.report.length),
    recallPrimary: share(
      hit(sample.report, primary).length,
      sample.report.length,
    ),
    retention: share(
      sample.preserve.length - preserveHits.length,
      sample.preserve.length,
    ),
    hits,
    preserveHits,
  };
}
