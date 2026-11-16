#!/usr/bin/env node
import {
  OUTSIDE_PATH_STARTS,
  PARENT_COMPONENT,
  READ_ONLY_GIT_SUBCOMMANDS,
  UNSAFE_GIT_OPTION_PREFIXES,
  VALUE_SEPARATORS,
} from "../common/git-command.ts";
import {
  launchNative,
  replaceOptions,
  selectedModel,
} from "../common/launch.ts";

const permissions = {
  allow: READ_ONLY_GIT_SUBCOMMANDS.flatMap((name) => [
    `Bash(git ${name})`,
    `Bash(git ${name} *)`,
  ]),
  deny: [
    ...UNSAFE_GIT_OPTION_PREFIXES.map((prefix) => `Bash(git * ${prefix}*)`),
    "Bash(git grep *-*O*)",
    "Bash(git blame *--con*)",
    ...[" ", ...VALUE_SEPARATORS].flatMap((separator) =>
      [...OUTSIDE_PATH_STARTS, PARENT_COMPONENT].map(
        (start) => `Bash(git *${separator}${start}*)`,
      ),
    ),
    `Bash(git */${PARENT_COMPONENT}*)`,
    // Quoting, escapes and expansions could hide an option from the prefix
    // rules above; both spellings deny a backslash whether or not the rule
    // parser treats it as an escape.
    ...["'", '"', "\\", "\\\\", "$", "`", "{", "<", ">"].map(
      (character) => `Bash(git *${character}*)`,
    ),
  ],
};

try {
  const args = replaceOptions(process.argv.slice(2), {
    "--tools": "list",
    "--allowedTools": "list",
    "--allowed-tools": "list",
    "--disallowedTools": "list",
    "--disallowed-tools": "list",
    "--mcp-config": "list",
    "--settings": "value",
    "--setting-sources": "value",
    "--model": "value",
    "--fallback-model": "value",
    "--permission-mode": "value",
    "--strict-mcp-config": "switch",
    "--disable-slash-commands": "switch",
    "--safe-mode": "switch",
    "--dangerously-skip-permissions": "switch",
    "--allow-dangerously-skip-permissions": "switch",
    "--bare": "switch",
    "--plugin-dir": "list",
    "--agents": "value",
    "--agent": "value",
  });
  launchNative(
    [
      ...args,
      ...(process.env.DEGREASER_MODEL_DISCOVERY === "1"
        ? []
        : ["--model", selectedModel(process.env)]),
      "--tools",
      "Read,Grep,Glob,Bash",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--settings",
      JSON.stringify({ disableAllHooks: true, apiKeyHelper: "", permissions }),
      "--permission-mode",
      "dontAsk",
      "--disable-slash-commands",
      "--safe-mode",
    ],
    process.env,
  );
} catch {
  process.stderr.write(
    "Claude worker profile could not launch. Check native compatibility and subscription policy.".concat(
      "\n",
    ),
    () => process.exit(1),
  );
}
