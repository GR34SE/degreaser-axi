import claude from "./claude/index.ts";
import codex from "./codex/index.ts";
import cursor from "./cursor/index.ts";
import pi from "./pi/index.ts";

export const HARNESSES = { codex, claude, pi, cursor };
export type Agent = keyof typeof HARNESSES;
export const AGENTS = Object.keys(HARNESSES) as Agent[];
export const PROFILE_LIMITATIONS = Object.fromEntries(
  AGENTS.map((id) => [id, [...HARNESSES[id].limitations]]),
) as Record<Agent, string[]>;
export const SUPPORTED_NATIVE_VERSIONS = Object.fromEntries(
  AGENTS.map((id) => [id, HARNESSES[id].supportedVersions.verified]),
) as Record<Agent, string>;

export const isAgent = (value: string): value is Agent =>
  Object.hasOwn(HARNESSES, value);
