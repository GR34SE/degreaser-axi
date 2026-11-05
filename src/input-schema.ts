import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import type { ReviewInput } from "./input.ts";
import { InputError } from "./input-error.ts";

const ajv = new Ajv({ strict: true, allErrors: true });
ajv.addSchema(
  JSON.parse(
    readFileSync(
      new URL("../assets/schemas/config-v1.json", import.meta.url),
      "utf8",
    ),
  ),
);
const validate = ajv.compile<ReviewInput>(
  JSON.parse(
    readFileSync(
      new URL("../assets/schemas/input-v1.json", import.meta.url),
      "utf8",
    ),
  ),
);

export function validateReviewInput(value: unknown): ReviewInput {
  if (!validate(value))
    throw new InputError(`Resolved input: ${ajv.errorsText(validate.errors)}`);
  return value;
}
