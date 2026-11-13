import type { ModelChoice } from "../types.ts";

export function codexModelChoices(models: readonly string[]): ModelChoice[] {
  const families = new Map<string, { model: string; version: string }>();
  for (const model of models) {
    const [, version, family = "gpt"] =
      /^gpt-(\d+(?:\.\d+)*)(?:-([a-z][a-z0-9-]*))?$/.exec(model) ?? [];
    if (!version) continue;
    const previous = families.get(family);
    if (
      !previous ||
      version.localeCompare(previous.version, "en", { numeric: true }) > 0
    )
      families.set(family, { model, version });
  }
  return [
    ...[...families].map(([family, { model }]) => ({
      model: `latest:${family}`,
      label: `${family} (latest)`,
      resolvedModel: model,
    })),
    ...models.map((model) => ({ model, label: model, resolvedModel: model })),
  ];
}
