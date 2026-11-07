import { isAbsolute } from "node:path";

async function inputCwd(): Promise<string> {
  return new Promise((resolve) => {
    let input = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.stdin.pause();
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
      } catch {
        // Missing or malformed input falls back to the process directory.
      }
      resolve(process.cwd());
    };
    const timer = setTimeout(finish, 100);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      input += chunk;
      if (input.length > 65536) {
        input = "";
        finish();
      }
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}

if (!process.env.DEGREASER_WORKER) {
  try {
    const plain = process.argv.includes("--plain");
    const cursor = process.argv.includes("--cursor");
    const cwd = plain ? process.cwd() : await inputCwd();
    const { startupContext } = await import("../src/startup-context.ts");
    const context = startupContext(cwd);
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
      if (output.length <= 1499) process.stdout.write(`${output}\n`);
    }
  } catch {
    // Session startup must not fail when local integration state is broken.
  }
}
