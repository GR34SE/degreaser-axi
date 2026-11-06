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

/** Input is exclusively assistant text collected by the public runtime boundary. */
export function parseResult(text: string, aspect: AspectId): WorkerResult {
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
  if (!validate(value))
    throw new ResultError(`Result schema: ${ajv.errorsText(validate.errors)}`);
  if (value.aspect !== aspect)
    throw new ResultError("Result aspect differs from the assignment.");
  return value;
}

export function ingestResult(
  text: string,
  aspect: AspectId,
  input: ReviewInput,
) {
  const result = parseResult(text, aspect);
  const rejections: Rejection[] = [];
  const blobs = new Map<string, string | null>();
  const unjudged: string[] = [];
  result.findings = result.findings.filter((finding, index) => {
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
          !lines
            .slice(startLine - 1, endLine)
            .join("")
            .includes(finding.quote)
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
  if (result.examinedPaths) {
    const assessed = new Set(
      input.paths.flatMap((p) => [p.path, p.oldPath].filter(Boolean)),
    );
    result.examinedPaths = result.examinedPaths.filter(
      (p) => assessed.has(p) && !unjudged.includes(p),
    );
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
