import { InputError } from "../errors.ts";
import type { Runtime } from "../exec/types.ts";
import { git } from "./exec.ts";

export function repositoryRoot(runtime: Runtime, cwd: string): string {
  const root = git(
    { ...runtime, env: { ...runtime.env, LC_ALL: "C" } },
    cwd,
    ["rev-parse", "--show-toplevel"],
    {
      allowFailure: (status, stderr) =>
        status === 128 && stderr.startsWith("fatal: not a git repository"),
    },
  );
  if (root === null)
    throw new InputError(
      "Not inside a Git repository. Run Degreaser inside the repository you want to review.",
      ["cd <repository> && degreaser-axi"],
    );
  return root.replace(/\n$/, "");
}
