import { readdirSync, readFileSync } from "node:fs";

import { createRequire } from "node:module";

import { join } from "node:path";

import type { AspectId } from "../../src/modules/aspect/api.ts";

import type { Candidate, FinderResult } from "../../src/review/ingest/types.ts";

export const { decode } = createRequire(import.meta.resolve("axi-sdk-js"))(
  "@toon-format/toon",
);

export function finding(
  startLine: number,
  endLine = startLine,
  side: "old" | "new" = "new",
  path = "source.ts",
): Candidate {
  return {
    location: { path, side, startLine, endLine },
    quote: `${side} line ${startLine}`,
    title: "Independent source cost",
  };
}

export function result(
  aspect: AspectId,
  findings: Candidate[],
  limitations: string[] = [],
): Omit<FinderResult, "examinedPaths"> {
  return {
    aspect,
    status: limitations.length
      ? "incomplete"
      : findings.length
        ? "findings"
        : "no-findings",
    findings,
    limitations,
  };
}

export function snapshot(root: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [path, readFileSync(path).toString("base64")];
      }),
  );
}
