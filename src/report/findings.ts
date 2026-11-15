import { ASPECT_IDS, type AspectId } from "../modules/aspect/api.ts";
import type { Finding, Location } from "../review/ingest/types.ts";
import type { Run } from "../state/run.ts";

export type AspectFinding = Finding & { aspect: AspectId };
export type StoredFinding = AspectFinding & { id: string };

const VERDICTS: Finding["verdict"][] = ["upheld", "unverified", "refuted"];
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function compareFindings(a: AspectFinding, b: AspectFinding) {
  return (
    VERDICTS.indexOf(a.verdict) - VERDICTS.indexOf(b.verdict) ||
    compareText(a.location.path, b.location.path) ||
    a.location.startLine - b.location.startLine ||
    compareText(a.location.side, b.location.side) ||
    a.location.endLine - b.location.endLine ||
    ASPECT_IDS.indexOf(a.aspect) - ASPECT_IDS.indexOf(b.aspect) ||
    compareText(a.title, b.title) ||
    compareText(a.quote, b.quote) ||
    compareText(a.action ?? "", b.action ?? "") ||
    compareText(a.reason ?? "", b.reason ?? "")
  );
}

export function findings(run: Run): StoredFinding[] {
  return run.tasks
    .flatMap((t) =>
      (t.result?.findings ?? []).map((f) => ({
        aspect: t.assignment.aspect,
        ...f,
      })),
    )
    .sort(compareFindings)
    .map((finding, index) => ({ id: `F${index + 1}`, ...finding }));
}

export const lines = ({ side, startLine, endLine }: Location) =>
  `${side}:${startLine}-${endLine}`;

export const where = (location: Location) =>
  `${location.path}:${lines(location)}`;
