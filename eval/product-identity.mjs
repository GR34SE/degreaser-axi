import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

export async function productIdentity(product) {
  const paths = ["package.json", "pnpm-lock.yaml"];
  for (const entry of await readdir(join(product, "dist"), {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isSymbolicLink())
      throw new Error("Built product contains a symlink.");
    if (entry.isFile())
      paths.push(relative(product, join(entry.parentPath, entry.name)));
  }
  const hash = createHash("sha256");
  for (const path of paths.sort()) {
    const bytes = await readFile(join(product, path));
    hash.update(JSON.stringify([path, bytes.length])).update(bytes);
  }
  return hash.digest("hex");
}
