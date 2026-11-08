import { readFileSync } from "node:fs";
import { Ajv, type ValidateFunction } from "ajv";

let instance: Ajv | undefined;
const ajv = () => (instance ??= new Ajv({ strict: true, allErrors: true }));
const loaded = new Map<string, string>();
const registered = new Set<string>();

function register(path: URL): string {
  const file = new URL(path);
  file.hash = "";
  const existing = loaded.get(file.href);
  if (existing) return existing;
  const schema = JSON.parse(readFileSync(file, "utf8")) as {
    $id: string;
  };
  if (!registered.has(schema.$id)) {
    ajv().addSchema(schema);
    registered.add(schema.$id);
  }
  loaded.set(file.href, schema.$id);
  return schema.$id;
}

export function schema<T>(
  path: URL,
  references: readonly URL[] = [],
): ValidateFunction<T> {
  for (const reference of references) register(reference);
  const id = register(path) + path.hash;
  const validate = ajv().getSchema<T>(id);
  if (!validate) throw new Error(`Missing packaged schema: ${id}`);
  return validate;
}

export const schemaErrors = (validate: ValidateFunction) =>
  ajv().errorsText(validate.errors);
