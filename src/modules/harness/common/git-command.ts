export const READ_ONLY_GIT_SUBCOMMANDS = [
  "diff",
  "log",
  "show",
  "blame",
  "status",
  "ls-files",
  "grep",
  "cat-file",
  "merge-base",
  "rev-parse",
] as const;

export const UNSAFE_GIT_OPTION_PREFIXES = ["--ou", "--op"] as const;

const plainWord = /^[\w./:@^~=,+%-]+$/;

export function readOnlyGitViolation(command: unknown): string | undefined {
  if (typeof command !== "string") return "The command must be text.";
  const [program, subcommand = "", ...args] = command.trim().split(/ +/);
  if (
    program !== "git" ||
    !(READ_ONLY_GIT_SUBCOMMANDS as readonly string[]).includes(subcommand)
  )
    return `Only git ${READ_ONLY_GIT_SUBCOMMANDS.join(", ")} are allowed.`;
  for (const arg of args) {
    if (!plainWord.test(arg))
      return "Quotes, globs, variables, redirection and other shell syntax are not allowed.";
    if (
      UNSAFE_GIT_OPTION_PREFIXES.some((prefix) => arg.startsWith(prefix)) ||
      (subcommand === "grep" && /^-[^-]*O/.test(arg))
    )
      return "Options that write files or start programs are not allowed.";
  }
  return undefined;
}
