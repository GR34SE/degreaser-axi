import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { recordResult } from "./runner.mjs";

export default function journal(hook, context) {
  if (hook !== "afterEach") return;
  const path = context.test.metadata?.journal;
  if (!path) throw new Error("Missing local evaluation journal path.");
  const next = recordResult(context.result);
  const records = existsSync(path)
    ? readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse)
    : [];
  const key = (record) => JSON.stringify([record.sample.id, record.repeat]);
  const index = records.findIndex((record) => key(record) === key(next));
  if (index < 0) records.push(next);
  else {
    if (JSON.stringify(records[index].sample) !== JSON.stringify(next.sample))
      throw new Error(
        "Cannot resume an evaluation with changed sample inputs.",
      );
    records[index] = next;
  }
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(
    temporary,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    { mode: 0o600 },
  );
  renameSync(temporary, path);
}
