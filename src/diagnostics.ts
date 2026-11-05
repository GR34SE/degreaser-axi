import { workerFailure } from "./worker-failure.ts";

export const PERMISSION_GUIDANCE =
  "Use the host's supported per-command approval if available, or run this command in an authorized session or authorized terminal. Do not change global policy, install permission rules or retry the fleet. Local home/report/finding/wait reads remain available where permitted.";

export class DiagnosticError extends Error {
  readonly code = "environment-blocked";
  readonly diagnosis: string;
  readonly help: string[];
  readonly details: Record<string, string>;
  constructor(
    diagnosis: string,
    message: string,
    help: string[],
    details: Record<string, string> = {},
  ) {
    super(message);
    this.name = "DiagnosticError";
    this.diagnosis = diagnosis;
    this.help = help;
    this.details = details;
  }
}

/** Translate known causes, never publish raw native output or guess from environment hints. */
export function diagnoseFailure(
  error: unknown,
  operation: string,
): DiagnosticError {
  if (error instanceof DiagnosticError) return error;
  const failure = workerFailure(error);
  const diagnosis = failure === "environment-blocked" ? "permission" : failure;
  const guidance: Partial<Record<typeof failure, string>> = {
    "environment-blocked": PERMISSION_GUIDANCE,
    authentication:
      "Restore the selected harness subscription login through its native login flow. Do not change permissions, accounts or models as a fallback.",
    network:
      "Check connectivity to the selected provider from this caller. A network failure alone does not prove a permission denial; preserve host policy and the exact model.",
    "model-unavailable":
      "Check availability of the selected exact model in the native harness. Ask the user before selecting a different model; no substitute was selected.",
    "rate-limited":
      "Wait for the selected account limit to clear. Do not switch accounts or models.",
    "account-disabled":
      "Restore access to the selected account with its provider before retrying.",
    timeout:
      "Check the selected native harness response and connectivity before retrying. Timeout alone does not prove a permission denial.",
  };
  return new DiagnosticError(diagnosis, `${operation} failed (${diagnosis}).`, [
    guidance[failure] ??
      "Inspect the selected native harness diagnostics locally. The cause is unverified; no permission, authentication or network failure is assumed.",
  ]);
}
