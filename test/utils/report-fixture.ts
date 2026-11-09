import { readdirSync, readFileSync } from "node:fs";

import { createRequire } from "node:module";

import { join } from "node:path";

import type { AspectId } from "../../src/modules/aspect/api.ts";

import type { Finding, WorkerResult } from "../../src/review/ingest/types.ts";

export const { decode } = createRequire(import.meta.resolve("axi-sdk-js"))(
  "@toon-format/toon",
);

export function finding(
  startLine: number,
  endLine = startLine,
  side: "old" | "new" = "new",
  path = "source.ts",
): Finding {
  return {
    location: { path, side, startLine, endLine },
    quote: `${side} line ${startLine}`,
    title: "Independent source cost",
    evidence: `Evidence at ${path}:${side}:${startLine}`,
    consequence: "Extra maintenance.",
    countercheck: "The neighboring caller does not need this behavior.",
    recommendation: "Remove the redundant behavior.",
  };
}

export function result(
  aspect: AspectId,
  findings: Finding[],
  limitations: string[] = [],
): WorkerResult {
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
