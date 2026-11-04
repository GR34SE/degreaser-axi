import { isAbsolute } from "node:path";
import { assertSubscriptionEnvironment } from "./native-environment.ts";

export function replaceOptions(
  args: string[],
  flags: Record<string, "switch" | "value" | "list">,
): string[] {
  const output: string[] = [];
  const remaining = [...args];
  while (remaining.length) {
    const arg = remaining.shift();
    if (arg === undefined) break;
    const [name = arg] = arg.split("=");
    const kind = flags[name];
    if (!kind) {
      output.push(arg);
      continue;
    }
    if (kind === "switch" || arg.includes("=")) continue;
    if (kind === "value") {
      remaining.shift();
      continue;
    }
    while (remaining[0] !== undefined && !remaining[0].startsWith("-"))
      remaining.shift();
  }
  return output;
}

export function launchNative(args: string[]): never {
  assertSubscriptionEnvironment(process.env);
  const executable = process.env.DEGREASER_NATIVE_EXECUTABLE;
  if (!executable || !isAbsolute(executable))
    throw new Error("Missing verified native executable.");
  // Replacing this launcher keeps the adapter's process ownership and signals intact.
  if (!process.execve)
    throw new Error("Native process replacement requires macOS and Node 24.");
  process.execve(executable, [executable, ...args], process.env);
  throw new Error("Native process replacement failed.");
}

export function selectedModel(): string {
  const model = process.env.DEGREASER_MODEL;
  if (!model || model.startsWith("-") || /[\s\0]/.test(model))
    throw new Error("Missing exact worker model.");
  return model;
}
