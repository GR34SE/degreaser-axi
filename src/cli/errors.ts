import { AxiError } from "axi-sdk-js";
import { diagnoseFailure } from "../util/diagnostics.ts";
import { InputError, StateError } from "../util/errors.ts";

export function commandFailure(
  error: unknown,
  name: string,
): Record<string, unknown> {
  if (error instanceof InputError || error instanceof StateError)
    throw new AxiError(
      error.message,
      error.code,
      error.help ?? [`degreaser-axi ${name} --help`],
    );
  if (error instanceof AxiError) throw error;
  const failure = diagnoseFailure(error, `${name} local operation`);
  return {
    error: failure.message,
    code: failure.code,
    diagnosis: failure.diagnosis,
    ...failure.details,
    help: failure.help,
  };
}
