import type { Readable, Writable } from "node:stream";

export interface IO {
  input: Readable;
  output: Pick<Writable, "write">;
  error: Writable;
  interactive: boolean;
}

export function processIO(): IO {
  return {
    input: process.stdin,
    output: process.stdout,
    error: process.stderr,
    interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
  };
}
