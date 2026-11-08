import type { HookGroup } from "axi-sdk-js";
import { type Agent, HARNESSES, isAgent } from "../modules/harness/api.ts";
import { schema } from "../util/schema.ts";

export interface Receipt {
  schemaVersion: 1;
  files: Record<string, { hash: string; owners: Agent[] }>;
  hooks: Partial<
    Record<
      Agent,
      {
        path: string;
        group: HookGroup | { command: string };
        created: boolean;
        others: string[];
      }
    >
  >;
}

export function validateReceipt(value: unknown): value is Receipt {
  if (
    !schema<Receipt>(new URL("./receipt.schema.json", import.meta.url))(value)
  )
    return false;
  return (
    Object.values(value.files).every((file) => file.owners.every(isAgent)) &&
    Object.keys(value.hooks).every(
      (id) =>
        isAgent(id) && HARNESSES[id].integration.hook.kind !== "extension",
    )
  );
}
