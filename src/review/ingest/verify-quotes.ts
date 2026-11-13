import type { AspectId } from "../../modules/aspect/api.ts";
import type { Runtime } from "../../util/exec/types.ts";
import { git } from "../../util/git/exec.ts";
import type { ReviewInput } from "../types.ts";
import { parseResult } from "./parse.ts";
import type { Finding, Rejection } from "./types.ts";

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

function quoteMatches(
  source: string,
  quote: string,
  side: "old" | "new",
): boolean {
  const haystack = trimLines(lineEndings(source));
  const found = (needle: string) =>
    (needle.replace(/\s/g, "").length >= 3 ||
      (needle.trim() !== "" && needle.trim() === haystack.trim())) &&
    haystack.includes(needle);
  if (found(trimLines(lineEndings(quote)).replace(/^\n+|\n+$/g, "")))
    return true;
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
  return found(stripped);
}

function omittedFinalLine(source: string, finding: Finding): boolean {
  const quote = lineEndings(finding.quote).replace(/\n$/, "").split("\n");
  const { startLine, endLine } = finding.location;
  if (
    quote.filter((line) => line.trim() !== "").length < 2 ||
    finding.quote.replace(/\s/g, "").length < 3 ||
    startLine + quote.length - 1 !== endLine + 1
  )
    return false;
  const lines = lineEndings(source).replace(/\n$/, "").split("\n");
  const matches = (at: number) =>
    quote.every((line, offset) => lines[at + offset] === line);
  return (
    matches(startLine - 1) &&
    !lines.some((_, at) => at !== startLine - 1 && matches(at))
  );
}

const beforeEndLineCorrection = (finding: Finding): Finding => ({
  ...finding,
  location: { ...finding.location, endLine: finding.location.endLine - 1 },
});

export function ingestResult(
  runtime: Runtime,
  text: string,
  aspect: AspectId,
  input: ReviewInput,
  established: readonly Finding[] = [],
) {
  const result = parseResult(text, aspect, input.repository);
  const known = new Set(
    established
      .flatMap((f) => [f, beforeEndLineCorrection(f)])
      .map((f) => JSON.stringify(f)),
  );
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
            git(runtime, input.repository, ["cat-file", "blob", oid], {
              allowFailure: () => true,
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
        ) {
          if (omittedFinalLine(source, finding)) finding.location.endLine++;
          else reason = "quote-mismatch";
        }
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
