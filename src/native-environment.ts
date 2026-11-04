export const INHERITED_WORKER_ENV = [
  "HOME",
  "PATH",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "USER",
  "LOGNAME",
  "SHELL",
  "TZ",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "PI_CODING_AGENT_DIR",
] as const;

export function workerEnvironment(
  parent: NodeJS.ProcessEnv,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED_WORKER_ENV) {
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  env.DEGREASER_WORKER = "1";
  return env;
}

export function assertSubscriptionEnvironment(env: NodeJS.ProcessEnv): void {
  if (
    Object.entries(env).some(
      ([key, value]) =>
        value &&
        (/^(ACPX_AUTH_|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|OPENAI_API_KEY|OPENAI_BASE_URL|AZURE_|AWS_|GOOGLE_API_KEY)/.test(
          key,
        ) ||
          /^(CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY)$/.test(
            key,
          )),
    )
  )
    throw new Error(
      "Subscription-only worker blocked by credential or routing overrides.",
    );
}
