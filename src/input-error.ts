export class InputError extends Error {
  override name = "InputError";
  readonly code = "invalid-input";
  /** Commands that resolve this error; defaults to the command's --help. */
  readonly help: string[] | undefined;
  constructor(message: string, help?: string[]) {
    super(message);
    this.help = help;
  }
}
