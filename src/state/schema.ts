import { schema } from "../util/schema.ts";

const locations = {
  config: new URL("../config/config.schema.json", import.meta.url),
  input: new URL("../review/input.schema.json", import.meta.url),
  patch: new URL("../review/prepare/patch.schema.json", import.meta.url),
  result: new URL("../review/ingest/result.schema.json", import.meta.url),
  run: new URL("./run.schema.json", import.meta.url),
  state: new URL("./state.schema.json", import.meta.url),
};
export function stateSchema<T>(name: keyof typeof locations) {
  return schema<T>(locations[name], Object.values(locations));
}
export function validDismissals(value: unknown): boolean {
  stateSchema("input");
  // Validate the ledger with the same field schema used by review input.
  return schema<unknown>(
    new URL(
      "../review/input.schema.json#/properties/dismissed",
      import.meta.url,
    ),
  )(value);
}
