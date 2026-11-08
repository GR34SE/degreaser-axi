export const gitEnvironment = (parent: NodeJS.ProcessEnv) => ({
  ...Object.fromEntries(
    Object.entries(parent).filter(([key]) => !key.startsWith("GIT_")),
  ),
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
});
