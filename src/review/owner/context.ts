import type { Runtime } from "../../util/exec/types.ts";
import type { ReviewInput } from "../types.ts";
import type { OwnerControl } from "./signals.ts";

export interface OwnerContext {
  runtime: Runtime;
  repository: string;
  input: ReviewInput;
  dir: string;
  control: OwnerControl;
  sizesOf: () => Map<string, number>;
}
