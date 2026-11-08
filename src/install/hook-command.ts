import { readFileSync, realpathSync } from "node:fs";
import { delimiter, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePortableHookCommand } from "axi-sdk-js";
import type { Runtime } from "../util/exec/types.ts";
import { shellQuote } from "../util/shell.ts";

export const HOOK_MARKER = "degreaser-startup-v1";
const bin = fileURLToPath(new URL("../main.js", import.meta.url));
const realPath = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
};

/** pnpm shims name their target; the SDK parses only npm shims. */
function pnpmShimTarget(path: string) {
  try {
    const target = /^# cmd-shim-target=(.+)$/m.exec(
      readFileSync(path, "utf8").slice(0, 65_536),
    )?.[1];
    return target ? realPath(target) : undefined;
  } catch {
    return undefined;
  }
}

export function hookExecutable(runtime: Runtime) {
  const portable = resolvePortableHookCommand(
    bin,
    ["degreaser-axi", "degreaser"],
    "degreaser",
    {
      pathEntries: (runtime.env.PATH ?? "").split(delimiter).filter(isAbsolute),
      pathExtensions: [""],
      resolveRealPath: realPath,
      resolveShimTarget: pnpmShimTarget,
    },
  );
  return portable === bin ? [runtime.executable, bin] : [portable];
}

export function hookSpec(runtime: Runtime, args: readonly string[] = []) {
  const executable = hookExecutable(runtime);
  const suffix = args.length ? ` ${args.join(" ")}` : "";
  const command = `if [ -z "\${DEGREASER_WORKER:-}" ]; then ${executable.map(shellQuote).join(" ")} startup-context${suffix} 2>/dev/null || :; fi # ${HOOK_MARKER}`;
  return { marker: HOOK_MARKER, command, timeoutSeconds: 2 };
}

const template =
  /^(if \[ -z "\$\{DEGREASER_WORKER:-\}" \]; then ).+( startup-context(?: --cursor)? 2>\/dev\/null \|\| :; fi # degreaser-startup-v1)$/;
/** Compare marked commands across installations without adopting foreign edits. */
export function withCurrentExecutable(runtime: Runtime, text: string) {
  return text.replace(
    template,
    (_, head: string, tail: string) =>
      `${head}${hookExecutable(runtime).map(shellQuote).join(" ")}${tail}`,
  );
}
