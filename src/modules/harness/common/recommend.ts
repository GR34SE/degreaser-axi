export type ModelTier = "light" | "balanced" | "strong";

const family = (id: string, names: string) =>
  new RegExp(`(?:^|[-/])(?:${names})(?:-|$)`, "i").test(id);
const lowGrok = /(?:^|[-/])(?:cursor-)?grok-[\d.]+-low(?:-fast)?(?:$|[^\w])/i;

export function modelTier(model: string): ModelTier | undefined {
  const id = model.replace(/^latest:/, "gpt-");
  if (family(id, "luna|haiku|mini|composer") || lowGrok.test(id))
    return "light";
  if (family(id, "terra|sonnet")) return "balanced";
  if (family(id, "opus|sol|pro|max|ultra")) return "strong";
  return undefined;
}
