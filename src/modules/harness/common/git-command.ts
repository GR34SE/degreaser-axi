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

export const UNSAFE_GIT_OPTION_PREFIXES = ["--ou", "--op", "--no-i"] as const;

export const OUTSIDE_PATH_STARTS = ["/", "~"] as const;
export const PARENT_COMPONENT = "..";
export const VALUE_SEPARATORS = ["=", ":"] as const;

const valueSeparator = new RegExp(`[${VALUE_SEPARATORS.join("")}]`);
const outsideRepository = (arg: string) =>
  arg
    .replace(/^-[A-Za-z]/, "")
    .split(valueSeparator)
    .some(
      (part) =>
        OUTSIDE_PATH_STARTS.some((start) => part.startsWith(start)) ||
        part.split("/").includes(PARENT_COMPONENT),
    );

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
      (subcommand === "grep" && /^-[^-]*O/.test(arg)) ||
      (subcommand === "blame" && arg.startsWith("--con"))
    )
      return "Options that write files, start programs or read outside the repository are not allowed.";
    if (outsideRepository(arg))
      return "Absolute paths, ~ and .. are not allowed; name paths relative to the repository root.";
  }
  return undefined;
}
