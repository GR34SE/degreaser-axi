import { InputError } from "../errors.ts";
import type { Runtime } from "../exec/types.ts";
import { git } from "./exec.ts";

export function repositoryRoot(runtime: Runtime, cwd: string): string {
  const root = git(runtime, cwd, ["rev-parse", "--show-toplevel"], {
    allowFailure: true,
  });
  if (root === null)
    throw new InputError(
      "Not inside a Git repository. Run Degreaser inside the repository you want to review.",
      ["cd <repository> && degreaser-axi"],
    );
  return root.replace(/\n$/, "");
}
