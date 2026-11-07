// Held-out measurement fixture for the low-value-comments rubric. It builds a
// disposable Git repository (base commit without comments, then worktree edits
// that add them) and states the expected verdict per comment. It is a manual,
// model-backed measurement aid and is deliberately not part of `pnpm test`.
// Usage: node scripts/comment-fixtures.ts <empty-directory>
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Expectation {
  id: string;
  file: string;
  /** Substring of the comment text that identifies it in a finding quote. */
  marker: string;
  verdict: "REPORT" | "PRESERVE";
  note: string;
}

export const task =
  "Document the cart, naming, retry, counter, webhook and invoice modules of a small billing library with explanatory comments. No behavior change.";

const files: Record<string, { base: string; changed: string }> = {
  "src/cart.ts": {
    base: `export function cartTotal(prices: number[]): number {
  let total = 0;
  for (const price of prices) {
    total += price;
  }
  return total;
}
`,
    changed: `export function cartTotal(prices: number[]): number {
  let total = 0;
  // Loop over every price in the list and add each one to the running total.
  for (const price of prices) {
    total += price;
  }
  return total;
}
`,
  },
  "src/names.ts": {
    base: `export function formatName(first: string, last: string): string {
  return \`\${last}, \${first}\`;
}
`,
    changed: `/**
 * Formats a name.
 *
 * @param first - The first name.
 * @param last - The last name.
 * @returns The formatted name.
 */
export function formatName(first: string, last: string): string {
  return \`\${last}, \${first}\`;
}
`,
  },
  "src/retry.ts": {
    base: `export function retryDelayMs(header: string | undefined): number {
  if (!header) return 1000;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : 1000;
}
`,
    changed: `// This function is responsible for working out how long to wait before the
// next attempt. It takes the Retry-After header value, which may be missing,
// and checks whether it exists. If it does not exist we use a default delay of
// one second. Otherwise we convert the text to a number. Note that this
// vendor sends Retry-After in seconds, not milliseconds, so we multiply by
// 1000. Finally we return the delay, falling back to the default if the value
// is not a valid number.
export function retryDelayMs(header: string | undefined): number {
  if (!header) return 1000;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : 1000;
}
`,
  },
  "src/counter.ts": {
    base: `const counts = new Map<string, number>();

export async function increment(key: string, audit: (key: string) => Promise<void>) {
  await audit(key);
  const current = counts.get(key) ?? 0;
  counts.set(key, current + 1);
  return current + 1;
}
`,
    changed: `const counts = new Map<string, number>();

export async function increment(key: string, audit: (key: string) => Promise<void>) {
  await audit(key);
  // Do not add an await between this read and the write below: a concurrent
  // request could interleave there and one increment would be silently lost.
  const current = counts.get(key) ?? 0;
  counts.set(key, current + 1);
  return current + 1;
}
`,
  },
  "src/webhook.ts": {
    base: `import { z } from "zod";

export const webhook = z.object({ id: z.string(), type: z.string() }).passthrough();
`,
    changed: `import { z } from "zod";

// Keep passthrough(): the payment SDK (v14) adds an undocumented "_meta" key to
// events, and .strict() would reject every real delivery in production.
export const webhook = z.object({ id: z.string(), type: z.string() }).passthrough();
`,
  },
  "src/index.ts": {
    base: `export function invoiceTotalCents(unitCents: number, quantity: number): number {
  if (quantity < 0) throw new RangeError("quantity must not be negative");
  return unitCents * quantity;
}
`,
    changed: `/**
 * Returns the invoice total in cents.
 *
 * @throws {RangeError} when \`quantity\` is negative.
 */
export function invoiceTotalCents(unitCents: number, quantity: number): number {
  if (quantity < 0) throw new RangeError("quantity must not be negative");
  return unitCents * quantity;
}
`,
  },
};

const supporting: Record<string, string> = {
  "package.json": JSON.stringify(
    {
      name: "billing-lib",
      version: "1.0.0",
      main: "src/index.ts",
      type: "module",
    },
    null,
    2,
  ),
  "CONTRIBUTING.md": `# Contributing

\`src/index.ts\` is the published entry point of this package. Every export of
that file is public API and the \`jsdoc/require-jsdoc\` lint rule requires a doc
comment stating the contract (return value and thrown errors). Other files in
\`src/\` are internal: no comment is required there.
`,
};

export const expectations: Expectation[] = [
  {
    id: "R1",
    file: "src/cart.ts",
    marker: "Loop over every price",
    verdict: "REPORT",
    note: "narrates the visible loop",
  },
  {
    id: "R2",
    file: "src/names.ts",
    marker: "Formats a name",
    verdict: "REPORT",
    note: "internal JSDoc repeating signature; no documentation obligation outside index.ts",
  },
  {
    id: "R3",
    file: "src/retry.ts",
    marker: "responsible for working out",
    verdict: "REPORT",
    note: "verbose narration; recommend keeping only the seconds-not-milliseconds fact",
  },
  {
    id: "P1",
    file: "src/counter.ts",
    marker: "Do not add an await",
    verdict: "PRESERVE",
    note: "concurrency trap",
  },
  {
    id: "P2",
    file: "src/webhook.ts",
    marker: "Keep passthrough()",
    verdict: "PRESERVE",
    note: "external library constraint",
  },
  {
    id: "P3",
    file: "src/index.ts",
    marker: "Returns the invoice total",
    verdict: "PRESERVE",
    note: "documentation obligation and thrown-error contract",
  },
];

export function buildFixture(dir: string): void {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  if (readdirSync(dir).length)
    throw new Error("Fixture directory must be empty.");
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  git("init", "-q", "-b", "main");
  for (const [path, text] of Object.entries(supporting)) put(path, text);
  for (const [path, v] of Object.entries(files)) put(path, v.base);
  git("add", "-A");
  git(
    "-c",
    "user.name=fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-q",
    "-m",
    "base",
  );
  for (const [path, v] of Object.entries(files)) put(path, v.changed);
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir)
    throw new Error(
      "Usage: node scripts/comment-fixtures.ts <empty-directory>",
    );
  mkdirSync(dir, { recursive: true });
  buildFixture(dir);
  console.log(JSON.stringify({ dir, task, expectations }, null, 2));
}
