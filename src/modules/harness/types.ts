import type { Runtime } from "../../util/exec/types.ts";

export interface Identity<Id extends string = string> {
  agent: Id;
  model: string;
}

export interface ModelChoice {
  model: string;
  label: string;
  resolvedModel: string;
}

export interface NativeProfile<Id extends string = string>
  extends Identity<Id> {
  command: string[];
  environment: Record<string, string>;
  adapterVersion: string;
  nativeVersion: string;
  versionNotice?: string;
  limitations: string[];
}

export interface VersionRange {
  verified: string;
  rule: "exact" | "major" | "date";
}

export interface Integration {
  extension?: URL;
  directory: string;
  userDirectory: string;
  configRoot?: string;
  skill: "shared" | "native";
  hook: {
    kind: "nested" | "flat" | "extension";
    arguments?: string[];
    event: string;
    filename: string | null;
    version?: number;
  };
  activation: string;
  invocation: string;
  completionNotice?: string;
}

export interface HarnessDefinition<Id extends string = string> {
  id: Id;
  displayName: string;
  executables: readonly string[];
  supportedVersions: VersionRange;
  adapterPackage: string | null;
  launcher: URL;
  guarantee: string;
  limitations: readonly string[];
  integration: Integration;
  subscription: (model: string) => string;
  recommendationPriority: number;
  recommendationRank: (model: string) => number | undefined;
  modelChoices?: (models: readonly string[]) => ModelChoice[];
  modelError: (model: string) => string | undefined;
  session: {
    systemPrompt: boolean;
    allowedTools?: string[];
    mode?: string;
    modeNotice?: string;
    setModel: boolean;
    nativeMaxTurns: boolean;
  };
  configure?: (
    environment: Record<string, string>,
    launcher: string,
    adapterManifest: string,
  ) => Promise<string>;
}

export interface Harness<Id extends string = string>
  extends HarnessDefinition<Id> {
  profile: <IdentityId extends Id>(
    runtime: Runtime,
    identity: Identity<IdentityId>,
    purpose?: "review" | "model-discovery",
    signal?: AbortSignal,
    spawned?: () => void,
  ) => Promise<NativeProfile<IdentityId>>;
  discoverModels: (
    runtime: Runtime,
    model: string,
    cwd: string,
    timeoutMs?: number,
    signal?: AbortSignal,
  ) => Promise<{
    availableModelIds: string[];
    versionNotice?: string;
  }>;
}
