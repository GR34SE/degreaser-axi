import { readOnlyGitViolation } from "../common/git-command.ts";

interface ToolCall {
  toolName: string;
  input: { command?: unknown };
}

interface Pi {
  on(
    event: "tool_call",
    handler: (event: ToolCall) => { block: true; reason: string } | undefined,
  ): void;
}

export default function gitGate(pi: Pi): void {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return undefined;
    const reason = readOnlyGitViolation(event.input.command);
    return reason ? { block: true, reason } : undefined;
  });
}
