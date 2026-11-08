export const hasCode = (error: unknown, code: string) =>
  error instanceof Error && "code" in error && error.code === code;
