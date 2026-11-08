// Degreaser-owned startup integration. Repair with degreaser-axi setup hooks.
import { execFile } from "node:child_process";

const executable = "__DEGREASER_EXECUTABLE__";
const args = ["__DEGREASER_ARGUMENTS__"];

export default function (pi) {
  pi.on("session_start", async (_event, ctx) => {
    const context = await new Promise((resolve) => {
      execFile(
        executable,
        args,
        { cwd: ctx.cwd, timeout: 2000, maxBuffer: 4096 },
        (error, stdout) => resolve(error ? "" : stdout.trim()),
      );
    });
    if (!context) return;
    if (
      ctx.sessionManager
        .getBranch()
        .some(
          (entry) =>
            entry.type === "custom_message" &&
            entry.customType === "degreaser-startup" &&
            entry.content === context,
        )
    )
      return;
    pi.sendMessage(
      { customType: "degreaser-startup", content: context, display: false },
      { triggerTurn: false },
    );
  });
}
