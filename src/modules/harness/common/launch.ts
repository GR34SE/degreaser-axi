import { isAbsolute } from "node:path";
import { assertSubscriptionEnvironment } from "./isolation.ts";

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

export function replaceCurrentProcess(
  executable: string,
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): never {
  // Node's process.execve is the POSIX binding on Linux and macOS.
  if (!process.execve)
    throw new Error(
      "Native process replacement requires Node 24 on Linux or macOS.",
    );
  process.execve(executable, [...argv], env);
  throw new Error("Native process replacement failed.");
}

export function launchNative(args: string[], env: NodeJS.ProcessEnv): never {
  assertSubscriptionEnvironment(env);
  const executable = env.DEGREASER_NATIVE_EXECUTABLE;
  if (!executable || !isAbsolute(executable))
    throw new Error("Missing verified native executable.");
  // Replacing this launcher keeps the adapter's process ownership and signals intact.
  replaceCurrentProcess(executable, [executable, ...args], env);
}

export function selectedModel(env: NodeJS.ProcessEnv): string {
  const model = env.DEGREASER_MODEL;
  if (!model || model.startsWith("-") || /[\s\0]/.test(model))
    throw new Error("Missing exact worker model.");
  return model;
}
