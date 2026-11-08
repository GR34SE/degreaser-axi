import { completeConfig as complete } from "../../src/config/defaults.ts";
import { resolveConfig as resolve } from "../../src/config/resolve.ts";
import type { ReviewControls } from "../../src/config/types.ts";
import { ASPECT_IDS } from "../../src/modules/aspect/api.ts";

export const resolveConfig = (data: unknown, controls: ReviewControls = {}) =>
  resolve(data, controls, ASPECT_IDS);
export const completeConfig = (data: unknown) => complete(data, ASPECT_IDS);
