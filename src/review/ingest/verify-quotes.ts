import type { AspectId } from "../../modules/aspect/api.ts";
import type { Runtime } from "../../util/exec/types.ts";
import { git } from "../../util/git/exec.ts";
import type { ReviewInput } from "../types.ts";
import { parseFinder, parseVerifier } from "./parse.ts";
import type { Quoted, Rejection } from "./types.ts";

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

function omittedFinalLine(source: string, quoted: Quoted): boolean {
  const quote = lineEndings(quoted.quote).replace(/\n$/, "").split("\n");
  const { startLine, endLine } = quoted.location;
  if (
    quote.filter((line) => line.trim() !== "").length < 2 ||
    quoted.quote.replace(/\s/g, "").length < 3 ||
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

type Blobs = Map<string, string | null>;

function blob(runtime: Runtime, input: ReviewInput, blobs: Blobs, id: string) {
  if (!blobs.has(id)) {
    try {
      blobs.set(
        id,
        git(runtime, input.repository, ["cat-file", "blob", id], {
          allowFailure: () => true,
        }),
      );
    } catch {
      blobs.set(id, null);
    }
  }
  return blobs.get(id) ?? null;
}

function locate(
  input: ReviewInput,
  { path, side }: Quoted["location"],
  anyPath: boolean,
): { id?: string; reason?: Rejection["reason"] } {
  const entry = input.paths.find((p) =>
    side === "old" ? p.oldPath === path : p.path === path,
  );
  if (!entry) {
    const commit = side === "old" ? input.base : input.tree;
    return anyPath && commit
      ? { id: `${commit}:${path}` }
      : { reason: anyPath ? "side-unavailable" : "path-not-assessed" };
  }
  const oid = side === "old" ? entry.oldOid : entry.newOid;
  const mode = side === "old" ? entry.oldMode : entry.newMode;
  if (!oid || (side === "old" && input.scope === "repository"))
    return { reason: "side-unavailable" };
  if (entry.binary || mode === "160000")
    return { reason: "source-unavailable" };
  return { id: oid };
}

function checkQuote(
  runtime: Runtime,
  input: ReviewInput,
  quoted: Quoted,
  blobs: Blobs,
  anyPath = false,
): Rejection["reason"] | undefined {
  const located = locate(input, quoted.location, anyPath);
  if (!located.id) return located.reason;
  const source = blob(runtime, input, blobs, located.id);
  if (source === null) return "source-unavailable";
  const { startLine, endLine, side } = quoted.location;
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  if (endLine < startLine || endLine > lines.length)
    return "range-out-of-bounds";
  if (
    quoteMatches(
      lines.slice(startLine - 1, endLine).join(""),
      quoted.quote,
      side,
    )
  )
    return undefined;
  if (!omittedFinalLine(source, quoted)) return "quote-mismatch";
  quoted.location.endLine++;
  return undefined;
}

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

export function ingestFinder(
  runtime: Runtime,
  text: string,
  aspect: AspectId,
  input: ReviewInput,
) {
  const result = parseFinder(text, aspect, input.repository);
  const blobs: Blobs = new Map();
  const rejections: Rejection[] = [];
  const seen = new Set<string>();
  result.findings = result.findings.filter((finding, index) => {
    const reason = checkQuote(runtime, input, finding, blobs);
    if (reason) rejections.push({ index: index + 1, reason });
    const key = JSON.stringify(finding);
    if (reason || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (result.kept) {
    const kept = result.kept.filter(
      (unit) => !checkQuote(runtime, input, unit, blobs),
    );
    const dropped = result.kept.length - kept.length;
    if (dropped)
      result.limitations.push(
        `Dropped ${plural(dropped, "kept unit")} whose quote did not match the source.`,
      );
    result.kept = kept;
  }
  if (result.status === "findings" && !result.findings.length) {
    result.status = rejections.length ? "incomplete" : "no-findings";
    if (rejections.length)
      result.limitations.push(
        "All proposed findings were rejected by literal source validation; this shard remains unresolved.",
      );
  }
  return { result, rejections };
}

export function ingestVerifier(
  runtime: Runtime,
  text: string,
  aspect: AspectId,
  input: ReviewInput,
  candidates: number,
) {
  const result = parseVerifier(text, aspect, input.repository);
  const blobs: Blobs = new Map();
  const judged = new Set<number>();
  const verdicts = result.verdicts.filter((verdict) => {
    const valid =
      verdict.candidate <= candidates &&
      !judged.has(verdict.candidate) &&
      (verdict.verdict === "refuted" || verdict.action !== undefined) &&
      (!verdict.evidence ||
        !checkQuote(runtime, input, verdict.evidence, blobs, true));
    if (valid) judged.add(verdict.candidate);
    return valid;
  });
  const dropped = result.verdicts.length - verdicts.length;
  if (dropped)
    result.limitations.push(
      `Discarded ${plural(dropped, "verdict")} with an unknown or repeated candidate, a missing action or an unmatched evidence quote.`,
    );
  result.verdicts = verdicts;
  return { result, dropped };
}
