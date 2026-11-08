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

export class StateError extends Error {
  code: string;
  /** Commands that resolve this error; defaults to the command's --help. */
  help: string[] | undefined;
  constructor(code: string, message: string, help?: string[]) {
    super(message);
    this.code = code;
    this.help = help;
  }
}

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

export class ResultError extends Error {
  /** Set when assistant text is an account block rather than a malformed review. */
  failure?: "account-disabled";
  constructor(message: string, failure?: "account-disabled") {
    super(message);
    this.name = "ResultError";
    if (failure) this.failure = failure;
  }
}

export class IntegrationConflict extends StateError {
  readonly path: string;
  readonly replaceable: boolean;
  constructor(path: string, replaceable: boolean) {
    super(
      "integration-conflict",
      replaceable
        ? `Integration conflict at ${path}: it differs from this Degreaser version's file. If you did not edit it (an older Degreaser or a fresh clone installed it), delete it and rerun; otherwise preserve your edits first. No selected integration was changed.`
        : `Integration conflict at ${path}. Preserve or move your edits, then rerun setup hooks with the same harnesses and scope. No selected integration was changed.`,
    );
    this.path = path;
    this.replaceable = replaceable;
  }
}
