import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function temporaryDirectory(prefix: string) {
  const path = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  return {
    path,
    [Symbol.dispose]() {
      rmSync(path, { recursive: true, force: true });
    },
  };
}
