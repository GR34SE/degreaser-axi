import type { AspectId } from "../../modules/aspect/api.ts";
import { billingRefusal } from "../../review/attempt/failure.ts";
import { ResultError } from "../../util/errors.ts";
import { schema, schemaErrors } from "../../util/schema.ts";
import type { WorkerResult } from "./types.ts";

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
  if (start < 0 || end < 0) {
    if (billingRefusal(text))
      throw new ResultError(
        "The selected account cannot continue until a payment method is available.",
        "account-disabled",
      );
    throw new ResultError("Missing final result block.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start + open.length, end));
  } catch {
    throw new ResultError("Final result JSON is malformed.");
  }
  omitEmptyOptionalReason(value);
  if (repository !== undefined) normalizeFindingPaths(value, repository);
  const validate = schema<WorkerResult>(
    new URL("./result.schema.json", import.meta.url),
  );
  if (!validate(value))
    throw new ResultError(`Result schema: ${schemaErrors(validate)}`);
  if (value.aspect !== aspect)
    throw new ResultError("Result aspect differs from the assignment.");
  return value;
}

/** `not-applicable` keeps an empty reason so validation still rejects it; no reason is invented. */
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

function normalizeFindingPaths(value: unknown, repository: string) {
  const findings = (value as { findings?: unknown })?.findings;
  if (!Array.isArray(findings)) return;
  for (const finding of findings) {
    const location = finding?.location;
    if (typeof location?.path === "string")
      location.path = repositoryRelative(repository, location.path);
  }
}

/** Workers may cite absolute or ./-prefixed paths; only the repository-relative form matters. */
const repositoryRelative = (repository: string, path: string) => {
  const root = `${repository}/`;
  return (path.startsWith(root) ? path.slice(root.length) : path).replace(
    /^(\.\/)+/,
    "",
  );
};
