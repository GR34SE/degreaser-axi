import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { InputError } from "../util/errors.ts";
import type { ProjectConfig } from "./types.ts";
import { validateConfig } from "./validate.ts";

export function readConfigText(path: string): string | null {
  try {
    if (!lstatSync(path).isFile())
      throw new InputError(
        "Root .degreaserrc.json must be a regular file, not a symlink.",
      );
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    if (error instanceof InputError) throw error;
    throw new InputError(
      "Root .degreaserrc.json could not be read. No configuration was changed.",
    );
  }
}

export function loadConfig(repository: string): ProjectConfig {
  let data: unknown;
  try {
    data = JSON.parse(
      readFileSync(join(repository, ".degreaserrc.json"), "utf8"),
    );
  } catch {
    throw new InputError(
      "Root .degreaserrc.json must exist and contain readable JSON. In a new Git worktree, commit .degreaserrc.json and .gitignore where init ran, or run init here.",
      ["degreaser-axi init"],
    );
  }
  return validateConfig(data);
}
