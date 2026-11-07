import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import type { AspectId } from "./config.ts";
import { git } from "./git.ts";
import type { ReviewInput } from "./input.ts";

export interface Finding {
  location: {
    path: string;
    side: "old" | "new";
    startLine: number;
    endLine: number;
  };
  quote: string;
  title: string;
  evidence: string;
  consequence: string;
  countercheck: string;
  recommendation: string;
  uncertainty?: string;
}
export interface WorkerResult {
  aspect: AspectId;
  status: "findings" | "no-findings" | "not-applicable" | "incomplete";
  findings: Finding[];
  limitations: string[];
  reason?: string;
  examinedPaths?: string[];
}
export interface Rejection {
  index: number;
  reason:
    | "path-not-assessed"
    | "side-unavailable"
    | "source-unavailable"
    | "range-out-of-bounds"
    | "quote-mismatch";
}
export class ResultError extends Error {}
const ajv = new Ajv({ strict: true, allErrors: true });
const validate = ajv.compile<WorkerResult>(
  JSON.parse(
    readFileSync(
      new URL("../assets/schemas/result-v1.json", import.meta.url),
      "utf8",
    ),
  ),
);

/** Workers may cite absolute or ./-prefixed paths; only the repository-relative form matters. */
const repositoryRelative = (repository: string, path: string) => {
  const root = `${repository}/`;
  return (path.startsWith(root) ? path.slice(root.length) : path).replace(
    /^(\.\/)+/,
    "",
  );
};

const lineEndings = (text: string) => text.replaceAll("\r\n", "\n");
const trimLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

/**
 * A quote matches the cited lines literally after CRLF and trailing-space
 * normalization. A quote copied from the patch with one diff marker per line
 * (`+`/space for new, `-`/space for old) also matches once every non-empty line
 * carries a marker consistent with its side. Anything else must be in the file.
 */
function quoteMatches(
  source: string,
  quote: string,
  side: "old" | "new",
): boolean {
  const haystack = trimLines(lineEndings(source));
  const needle = trimLines(lineEndings(quote)).replace(/^\n+|\n+$/g, "");
  const meaningful = needle.replace(/\s/g, "").length;
  if (meaningful < 3 && needle.trim() !== haystack.trim()) return false;
  if (haystack.includes(needle)) return true;
  const lines = lineEndings(quote)
    .replace(/^\n+|\n+$/g, "")
    .split("\n");
  const marker = side === "old" ? /^[- ]/ : /^[+ ]/;
  const filled = lines.filter((line) => line.trim() !== "");
  if (!filled.length || !filled.every((line) => marker.test(line)))
    return false;
  const stripped = trimLines(
    lines.map((line) => (marker.test(line) ? line.slice(1) : line)).join("\n"),
  );
  return stripped.trim() !== "" && haystack.includes(stripped);
}

/**
 * Input is exclusively assistant text collected by the public runtime boundary.
 * With `repository`, finding paths are normalized before schema validation.
 */
export function parseResult(
  text: string,
  aspect: AspectId,
  repository?: string,
): WorkerResult {
  const open = "<degreaser-result>",
    close = "</degreaser-result>";
  const start = text.lastIndexOf(open);
  const end = text.indexOf(close, start + open.length);
  if (start < 0 || end < 0)
    throw new ResultError("Missing final result block.");
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start + open.length, end));
  } catch {
    throw new ResultError("Final result JSON is malformed.");
  }
  if (repository !== undefined) normalizeFindingPaths(value, repository);
  if (!validate(value))
    throw new ResultError(`Result schema: ${ajv.errorsText(validate.errors)}`);
  if (value.aspect !== aspect)
    throw new ResultError("Result aspect differs from the assignment.");
  return value;
}

function normalizeFindingPaths(value: unknown, repository: string) {
  const findings = (value as { findings?: unknown })?.findings;
  if (!Array.isArray(findings)) return;
  for (const finding of findings) {
    const location = finding?.location;
    if (typeof location?.path === "string")
      location.path = repositoryRelative(repository, location.path);
  }
}

export function ingestResult(
  text: string,
  aspect: AspectId,
  input: ReviewInput,
  established: readonly Finding[] = [],
) {
  const result = parseResult(text, aspect, input.repository);
  const known = new Set(established.map((f) => JSON.stringify(f)));
  const rejections: Rejection[] = [];
  const blobs = new Map<string, string | null>();
  const unjudged: string[] = [];
  result.findings = result.findings.filter((finding, index) => {
    if (known.has(JSON.stringify(finding))) return false;
    const { path, side, startLine, endLine } = finding.location;
    const entry = input.paths.find((p) =>
      side === "old" ? p.oldPath === path : p.path === path,
    );
    let reason: Rejection["reason"] | undefined;
    const oid = side === "old" ? entry?.oldOid : entry?.newOid;
    const mode = side === "old" ? entry?.oldMode : entry?.newMode;
    if (!entry) reason = "path-not-assessed";
    else if (!oid || (side === "old" && input.scope === "repository"))
      reason = "side-unavailable";
    else if (entry.binary || mode === "160000") reason = "source-unavailable";
    else {
      if (!blobs.has(oid)) {
        try {
          blobs.set(
            oid,
            git(input.repository, ["cat-file", "blob", oid], {
              allowFailure: true,
            }),
          );
        } catch {
          blobs.set(oid, null);
        }
      }
      const source = blobs.get(oid);
      if (source === null || source === undefined)
        reason = "source-unavailable";
      else {
        const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
        if (endLine < startLine || endLine > lines.length)
          reason = "range-out-of-bounds";
        else if (
          !quoteMatches(
            lines.slice(startLine - 1, endLine).join(""),
            finding.quote,
            side,
          )
        )
          reason = "quote-mismatch";
      }
    }
    if (reason) {
      rejections.push({ index: index + 1, reason });
      if (entry) unjudged.push(entry.path, entry.oldPath ?? entry.path);
    }
    return !reason;
  });
  if (
    result.status === "findings" &&
    !result.findings.length &&
    !rejections.length
  )
    result.status = "no-findings";
  if (result.examinedPaths) {
    const assessed = new Set(
      input.paths.flatMap((p) => [p.path, p.oldPath].filter(Boolean)),
    );
    result.examinedPaths = [
      ...new Set(
        result.examinedPaths.map((p) =>
          repositoryRelative(input.repository, p),
        ),
      ),
    ].filter((p) => assessed.has(p) && !unjudged.includes(p));
    if (result.status === "no-findings" && !result.examinedPaths.length) {
      result.status = "incomplete";
      result.limitations.push(
        "Reported no findings without examining any assessed path; this aspect remains unresolved.",
      );
    }
  }
  if (rejections.length && !result.findings.length) {
    result.status = "incomplete";
    result.limitations.push(
      "All proposed findings were rejected by literal source validation; this aspect remains unresolved.",
    );
  }
  return { result, rejections };
}
