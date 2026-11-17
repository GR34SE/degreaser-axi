export function errorSummary(error: unknown) {
  if (!(error instanceof Error)) return "Unknown error";
  const code =
    "code" in error && typeof error.code === "string"
      ? ` [${error.code.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64)}]`
      : "";
  const message = error.message.split(/[\r\n]/, 1)[0]?.slice(0, 300) ?? "";
  return `${error.name.slice(0, 80)}${code}: ${message}`;
}
