export type ExitCode = 0 | 1 | 2 | 3;

export function completenessCode(status: string): ExitCode {
  return status === "running"
    ? 3
    : status === "completed" || status === "no-changes"
      ? 0
      : 1;
}
export function setExitCode(code: number): void {
  process.exitCode = code;
}
