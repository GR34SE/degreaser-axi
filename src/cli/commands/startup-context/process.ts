import { isAbsolute } from "node:path";
import { ASPECT_IDS } from "../../../modules/aspect/api.ts";
import type { Factory } from "../../factory.ts";

async function inputCwd(f: Factory): Promise<string> {
  return new Promise((resolve) => {
    let input = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      f.io.input.pause();
      try {
        const value = JSON.parse(input) as {
          cwd?: unknown;
          workspace_roots?: unknown;
        } | null;
        const cwd = [
          value?.cwd,
          ...(Array.isArray(value?.workspace_roots)
            ? value.workspace_roots
            : []),
        ].find((dir) => typeof dir === "string" && isAbsolute(dir));
        if (typeof cwd === "string") {
          resolve(cwd);
          return;
        }
      } catch {}
      resolve(f.cwd);
    };
    const timer = setTimeout(finish, 100);
    f.io.input.setEncoding("utf8");
    f.io.input.on("data", (chunk: string) => {
      input += chunk;
      if (input.length > 65536) {
        input = "";
        finish();
      }
    });
    f.io.input.on("end", finish);
    f.io.input.on("error", finish);
  });
}

export async function startupContextMain(f: Factory, args: string[]) {
  if (!f.env.DEGREASER_WORKER) {
    try {
      const plain = args.includes("--plain");
      const cursor = args.includes("--cursor");
      const cwd = plain ? f.cwd : await inputCwd(f);
      const { startupContext } = await import(
        "../../../install/startup-context.ts"
      );
      const context = startupContext(cwd, f, ASPECT_IDS);
      if (context) {
        const output = plain
          ? context
          : cursor
            ? JSON.stringify({ additional_context: context })
            : JSON.stringify({
                hookSpecificOutput: {
                  hookEventName: "SessionStart",
                  additionalContext: context,
                },
              });
        if (output.length <= 1499) f.io.output.write(`${output}\n`);
      }
    } catch {}
  }
}
