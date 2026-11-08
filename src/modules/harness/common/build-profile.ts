import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DiagnosticError } from "../../../util/errors.ts";
import type { Runtime } from "../../../util/exec/types.ts";
import type { HarnessDefinition, Identity, NativeProfile } from "../types.ts";
import { nativeExecutable } from "./executable.ts";
import { workerEnvironment } from "./isolation.ts";
import { assertSupportedVersion } from "./versions.ts";

const require = createRequire(import.meta.url);

export async function buildProfile<Id extends string>(
  definition: HarnessDefinition,
  runtime: Runtime,
  identity: Identity<Id>,
  purpose: "review" | "model-discovery" = "review",
  signal?: AbortSignal,
  spawned?: () => void,
): Promise<NativeProfile<Id>> {
  if (purpose === "review") {
    if (
      !identity.model ||
      /[\s\0]/.test(identity.model) ||
      identity.model.startsWith("-")
    )
      throw new Error("An exact model ID is required.");
    const error = definition.modelError(identity.model);
    if (error) throw new Error(error);
  }
  const environment = workerEnvironment(runtime.env);
  environment.DEGREASER_MODEL = identity.model;
  if (purpose === "model-discovery")
    environment.DEGREASER_MODEL_DISCOVERY = "1";
  const launcher = fileURLToPath(definition.launcher);
  let command = [runtime.executable, launcher];
  let adapterVersion = "native-acp";
  let nativeVersion: string;
  let versionNotice: string | undefined;
  const pkg = definition.adapterPackage;
  let manifestPath = "";
  if (pkg) {
    try {
      manifestPath = require.resolve(`${pkg}/package.json`);
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "MODULE_NOT_FOUND"
        )
      )
        throw error;
      throw new DiagnosticError(
        "missing-dependency",
        `The pinned ${identity.agent} adapter is missing.`,
        [
          "Restore the installed Degreaser package and its pinned dependencies, then run degreaser-axi doctor.",
        ],
      );
    }
    const [manifestText, packageText] = await Promise.all([
      readFile(manifestPath, "utf8"),
      readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
    ]);
    const manifest = JSON.parse(manifestText) as {
      version: string;
      bin: Record<string, string>;
    };
    const dependencies = (
      JSON.parse(packageText) as { dependencies: Record<string, string> }
    ).dependencies;
    const version = dependencies[pkg];
    if (!version || manifest.version !== version)
      throw new DiagnosticError(
        "unsupported-adapter-version",
        "Installed adapter version differs from the pinned worker profile.",
        [
          "Restore the installed Degreaser package and its pinned dependencies. Do not update the native host or switch models.",
        ],
      );
    const entry = Object.values(manifest.bin)[0];
    if (!entry) throw new Error("Installed adapter executable is unavailable.");
    adapterVersion = version;
    command = [runtime.executable, join(dirname(manifestPath), entry)];
  }
  const configured = await definition.configure?.(
    environment,
    launcher,
    manifestPath,
  );
  if (configured)
    nativeVersion = assertSupportedVersion(definition, configured).version;
  else {
    const native = await nativeExecutable(
      runtime,
      definition,
      environment,
      signal,
      spawned,
    );
    environment.DEGREASER_NATIVE_EXECUTABLE = native.path;
    nativeVersion = native.version;
    versionNotice = native.notice;
  }
  return {
    ...identity,
    command,
    environment,
    adapterVersion,
    nativeVersion,
    ...(versionNotice ? { versionNotice } : {}),
    limitations: [...definition.limitations],
  };
}
