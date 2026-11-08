import { InputError } from "../../../util/errors.ts";
import type { Runtime } from "../../../util/exec/types.ts";
import { requireGitBytes } from "../../../util/git/exec.ts";
import { isUtf8, nulList } from "../../../util/text.ts";
import type { ScopePath } from "./types.ts";

export const diffFlags = [
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--no-relative",
  "--ignore-submodules=none",
  "--submodule=short",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "--diff-algorithm=myers",
  "--no-indent-heuristic",
  "-M50%",
];
export function parseRaw(raw: string): ScopePath[] {
  const tokens = nulList(raw);
  const entries: ScopePath[] = [];
  for (let i = 0; i < tokens.length; ) {
    const header = tokens[i++];
    const first = tokens[i++];
    if (!header || first === undefined)
      throw new InputError("Invalid Git raw path record.");
    const [oldMode, newMode, oldOid, newOid, status] = header
      .slice(1)
      .split(" ");
    if (!oldMode || !newMode || !oldOid || !newOid || !status)
      throw new InputError("Invalid Git raw header.");
    const path = status.startsWith("R") ? tokens[i++] : first;
    if (path === undefined)
      throw new InputError("Missing Git rename destination.");
    entries.push({
      path,
      oldPath: status === "A" ? null : first,
      status,
      oldMode: oldMode === "000000" ? null : oldMode,
      newMode: newMode === "000000" ? null : newMode,
      oldOid: /^0+$/.test(oldOid) ? null : oldOid,
      newOid: /^0+$/.test(newOid) ? null : newOid,
      binary: false,
    });
  }
  return entries;
}

export function binaryPaths(numstat: string): Set<string> {
  const tokens = nulList(numstat);
  const paths = new Set<string>();
  for (let i = 0; i < tokens.length; ) {
    const record = tokens[i++];
    if (record === undefined) break;
    const first = record.indexOf("\t");
    const second = record.indexOf("\t", first + 1);
    let path = record.slice(second + 1);
    if (path === "") {
      i++; // Rename source; coverage and evidence use both sides from --raw.
      path = tokens[i++] ?? "";
    }
    if (record.slice(0, first) === "-") paths.add(path);
  }
  return paths;
}

const fileType = (mode: string | null) =>
  mode === null ? null : Number.parseInt(mode, 8) & 0o170000;

/**
 * Owner of each patch section, in order. Git emits patch sections in `--raw`
 * order, except that a change between file, symlink and gitlink types is
 * written as a deletion section followed by a creation section.
 */
export function patchSectionOwners(paths: ScopePath[]): ScopePath[] {
  return paths.flatMap((path) =>
    path.oldMode !== null &&
    path.newMode !== null &&
    fileType(path.oldMode) !== fileType(path.newMode)
      ? [path, path]
      : [path],
  );
}

/**
 * A section whose bytes are not valid UTF-8 (a Latin-1 file, on either side)
 * is replaced by Git's own binary stub and its path is marked binary, so
 * coverage, evidence checks and reports treat it like any binary file.
 */
export function omitNonUtf8Sections(
  patch: Buffer,
  paths: ScopePath[],
  omitted: Set<string>,
): string {
  if (isUtf8(patch)) return patch.toString("utf8");
  const marker = Buffer.from("diff --git ");
  const starts: number[] = [];
  for (let at = patch.indexOf(marker); at !== -1; ) {
    if (at === 0 || patch[at - 1] === 0x0a) starts.push(at);
    at = patch.indexOf(marker, at + 1);
  }
  const owners = patchSectionOwners(paths);
  if (starts.length !== owners.length || starts[0] !== 0)
    throw new InputError(
      "Git patch sections do not match the changed paths; no run was started.",
    );
  return starts
    .map((start, i) => {
      const section = patch.subarray(start, starts[i + 1] ?? patch.length);
      if (isUtf8(section)) return section.toString("utf8");
      const path = owners[i];
      if (!path) throw new InputError("Git patch section has no path record.");
      path.binary = true;
      omitted.add(path.path);
      const lines = section.toString("latin1").split("\n");
      const label = (prefix: string) =>
        lines.find((line) => line.startsWith(prefix))?.slice(prefix.length);
      const head = lines.slice(
        0,
        lines.findIndex((line) => line.startsWith("--- ")),
      );
      return `${head.join("\n")}\nBinary files ${label("--- ")} and ${label("+++ ")} differ\n`;
    })
    .join("");
}

/**
 * A symlink's Git content is its target text. Workers cannot follow a directory
 * link or run readlink, so the coordinator records the text from the blob. A
 * target that is not UTF-8 is treated like other non-UTF-8 content.
 */
export function readLinkTargets(
  runtime: Runtime,
  repository: string,
  paths: ScopePath[],
  omitted: Set<string>,
) {
  for (const path of paths)
    for (const side of ["old", "new"] as const) {
      const oid = side === "old" ? path.oldOid : path.newOid;
      if ((side === "old" ? path.oldMode : path.newMode) !== "120000" || !oid)
        continue;
      const bytes = requireGitBytes(runtime, repository, [
        "cat-file",
        "blob",
        oid,
      ]);
      if (!isUtf8(bytes)) {
        path.binary = true;
        omitted.add(path.path);
      } else
        path[side === "old" ? "oldLink" : "newLink"] = bytes.toString("utf8");
    }
}
