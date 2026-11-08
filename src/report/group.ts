import { ASPECT_IDS, type AspectId } from "../modules/aspect/api.ts";
import type { Finding } from "../review/ingest/types.ts";
import type { Run } from "../state/run.ts";

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
type AspectFinding = Finding & { aspect: AspectId };
function compareFindings(a: AspectFinding, b: AspectFinding): number {
  return (
    compareText(a.location.path, b.location.path) ||
    a.location.startLine - b.location.startLine ||
    compareText(a.location.side, b.location.side) ||
    a.location.endLine - b.location.endLine ||
    ASPECT_IDS.indexOf(a.aspect) - ASPECT_IDS.indexOf(b.aspect) ||
    compareText(a.title, b.title) ||
    compareText(a.quote, b.quote) ||
    compareText(a.evidence, b.evidence) ||
    compareText(a.consequence, b.consequence) ||
    compareText(a.countercheck, b.countercheck) ||
    compareText(a.recommendation, b.recommendation) ||
    compareText(a.uncertainty ?? "", b.uncertainty ?? "") ||
    Number(a.uncertainty !== undefined) - Number(b.uncertainty !== undefined)
  );
}
export function findings(run: Run) {
  const ordered = run.tasks
    .flatMap((t) =>
      (t.result?.findings ?? []).map((f) => ({
        aspect: t.assignment.aspect,
        ...f,
      })),
    )
    .sort(
      (a, b) =>
        compareText(a.location.path, b.location.path) ||
        compareText(a.location.side, b.location.side) ||
        compareFindings(a, b),
    );
  const groups: {
    first: AspectFinding;
    end: number;
    members: AspectFinding[];
  }[] = [];
  for (const finding of ordered) {
    const group = groups.at(-1);
    if (
      group &&
      group.first.location.path === finding.location.path &&
      group.first.location.side === finding.location.side &&
      finding.location.startLine <= group.end
    ) {
      group.members.push(finding);
      group.end = Math.max(group.end, finding.location.endLine);
    } else {
      groups.push({
        first: finding,
        end: finding.location.endLine,
        members: [finding],
      });
    }
  }
  return groups
    .sort((a, b) => compareFindings(a.first, b.first))
    .flatMap((group, index) =>
      group.members.map((finding) => ({ group: `G${index + 1}`, ...finding })),
    )
    .map((finding, index) => ({ id: `F${index + 1}`, ...finding }));
}
