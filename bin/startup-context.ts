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
        const value: unknown = JSON.parse(input);
        if (
          typeof value === "object" &&
          value !== null &&
          "cwd" in value &&
          typeof value.cwd === "string" &&
          value.cwd
        ) {
          resolve(value.cwd);
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
    const cwd = plain ? process.cwd() : await inputCwd();
    const { startupContext } = await import("../src/startup-context.ts");
    const context = startupContext(cwd);
    if (context) {
      const output = plain
        ? context
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
