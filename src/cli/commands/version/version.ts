import { VERSION } from "../../../version.ts";

export { spec } from "./spec.ts";
export function run() {
  return { output: VERSION };
}
