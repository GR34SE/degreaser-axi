import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import reviewPolicy from "./review-policy.json" with { type: "json" };

export function reserveSessions(file, limit, aspects) {
  const lock = `${file}.lock`;
  const descriptor = openSync(lock, "wx", 0o600);
  try {
    const state = existsSync(file)
      ? JSON.parse(readFileSync(file, "utf8"))
      : { schemaVersion: 1, limit, reserved: 0 };
    if (
      state.schemaVersion !== 1 ||
      state.limit !== limit ||
      !Number.isSafeInteger(state.reserved) ||
      state.reserved < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      !Number.isSafeInteger(aspects) ||
      aspects < 1
    )
      throw new Error("Invalid session admission receipt or changed budget.");
    const next = state.reserved + aspects * (reviewPolicy.maxRetries + 1);
    if (next > limit)
      throw new Error(
        "Session budget exhausted, including prior/resumed attempts.",
      );
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ ...state, reserved: next }), {
      mode: 0o600,
    });
    renameSync(temporary, file);
    return next;
  } finally {
    closeSync(descriptor);
    unlinkSync(lock);
  }
}
