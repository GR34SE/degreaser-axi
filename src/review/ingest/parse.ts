import type { AspectId } from "../../modules/aspect/api.ts";
import { billingRefusal } from "../../review/attempt/failure.ts";
import { ResultError } from "../../util/errors.ts";
import { schema, schemaErrors } from "../../util/schema.ts";
import type { FinderResult, Quoted, VerifierResult } from "./types.ts";

export function loadResultSchemas() {
  schema(new URL("./find.schema.json", import.meta.url));
  schema(new URL("./verify.schema.json", import.meta.url));
}

function resultBlock(text: string): unknown {
  const open = "<degreaser-result>",
    close = "</degreaser-result>";
  const start = text.lastIndexOf(open);
  const end = text.indexOf(close, start + open.length);
  if (start < 0 || end < 0) {
    if (billingRefusal(text))
      throw new ResultError(
        "The selected account cannot continue until a payment method is available.",
        "account-disabled",
      );
    throw new ResultError("Missing final result block.");
  }
  try {
    return JSON.parse(text.slice(start + open.length, end));
  } catch {
    throw new ResultError("Final result JSON is malformed.");
  }
}

function validated<T extends { aspect: AspectId }>(
  value: unknown,
  file: string,
  aspect: AspectId,
): T {
  const validate = schema<T>(new URL(file, import.meta.url));
  if (!validate(value))
    throw new ResultError(`Result schema: ${schemaErrors(validate)}`);
  if (value.aspect !== aspect)
    throw new ResultError("Result aspect differs from the assignment.");
  return value;
}

export function parseFinder(
  text: string,
  aspect: AspectId,
  repository?: string,
): FinderResult {
  const value = resultBlock(text);
  omitEmptyOptionalReason(value);
  if (repository !== undefined) {
    const result = value as { findings?: unknown; examinedPaths?: unknown };
    normalizePaths(result.findings, repository);
    if (Array.isArray(result.examinedPaths))
      result.examinedPaths = result.examinedPaths.map((path) =>
        typeof path === "string" ? repositoryRelative(repository, path) : path,
      );
  }
  return validated<FinderResult>(value, "./find.schema.json", aspect);
}

export function parseVerifier(
  text: string,
  aspect: AspectId,
  repository?: string,
): VerifierResult {
  const value = resultBlock(text);
  const verdicts = (value as { verdicts?: unknown })?.verdicts;
  if (repository !== undefined && Array.isArray(verdicts))
    normalizePaths(
      verdicts.map((v) => v?.evidence),
      repository,
    );
  return validated<VerifierResult>(value, "./verify.schema.json", aspect);
}

function omitEmptyOptionalReason(value: unknown) {
  if (typeof value !== "object" || value === null) return;
  const result = value as { status?: unknown; reason?: unknown };
  if (
    "reason" in result &&
    result.status !== "not-applicable" &&
    (result.reason === null ||
      (typeof result.reason === "string" && result.reason.trim() === ""))
  )
    delete result.reason;
}

function normalizePaths(items: unknown, repository: string) {
  if (!Array.isArray(items)) return;
  for (const item of items as (Partial<Quoted> | undefined)[]) {
    const location = item?.location;
    if (typeof location?.path === "string")
      location.path = repositoryRelative(repository, location.path);
  }
}

const repositoryRelative = (repository: string, path: string) => {
  const root = `${repository}/`;
  return (path.startsWith(root) ? path.slice(root.length) : path).replace(
    /^(\.\/)+/,
    "",
  );
};
