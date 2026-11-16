import type { Runtime } from "../../util/exec/types.ts";
import type { ReviewInput } from "../types.ts";
import type { OwnerControl } from "./signals.ts";
import type { Slots } from "./slots.ts";

export interface OwnerContext {
  runtime: Runtime;
  repository: string;
  input: ReviewInput;
  dir: string;
  startedAt: number;
  control: OwnerControl;
  slots: Slots;
  verifierSlots: Slots;
}
