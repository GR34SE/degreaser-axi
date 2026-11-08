import { ownerPath } from "../../state/ownership.ts";
import type { Run } from "../../state/run.ts";
import { loadRun } from "../../state/store.ts";
import { StateError } from "../../util/errors.ts";
import type { Runtime } from "../../util/exec/types.ts";
import type { ResumeControls } from "../types.ts";

export async function startOwner(
  runtime: Runtime,
  run: Run,
  controls?: ResumeControls,
) {
  const owner = runtime.spawn(
    runtime.executable,
    [...runtime.arguments, ownerPath, run.repository, run.id],
    {
      cwd: run.repository,
      env: runtime.env,
      detached: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      owner.once("error", reject);
      owner.once("exit", () =>
        reject(
          new StateError(
            "owner-failed",
            `Owner admission failed. Use degreaser-axi report ${run.id}.`,
          ),
        ),
      );
      owner.once("message", (message: { code?: string; message?: string }) => {
        if (message.code)
          reject(
            new StateError(
              message.code,
              message.message ?? "Owner admission refused.",
            ),
          );
        else resolve();
      });
      owner.once("spawn", () =>
        owner.send({ controls }, (error) => {
          if (error)
            reject(
              new StateError(
                "owner-failed",
                `Could not deliver owner admission. Use degreaser-axi report ${run.id}.`,
              ),
            );
        }),
      );
    });
  } finally {
    if (owner.connected) owner.disconnect();
    owner.unref();
  }
  return loadRun(run.repository, run.id);
}
