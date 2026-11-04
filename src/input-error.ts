export class InputError extends Error {
  override name = "InputError";
  readonly code = "invalid-input";
}
