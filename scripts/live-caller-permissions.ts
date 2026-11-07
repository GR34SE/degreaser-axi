import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { INHERITED_WORKER_ENV } from "../src/native-environment.ts";
import type { Run } from "../src/storage.ts";
import { stopRuns } from "./stop-runs.ts";

const cli = fileURLToPath(
  new URL("../dist/bin/degreaser-axi.js", import.meta.url),
);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const command = `${quote(process.execPath)} ${quote(cli)}`;

function policySnapshot() {
  const root = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const rules = join(root, "rules");
  const paths = [
    join(root, "config.toml"),
    join(root, "hooks.json"),
    ...(existsSync(rules)
      ? readdirSync(rules)
          .sort()
          .map((p) => join(rules, p))
      : []),
  ];
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path);
    if (existsSync(path)) hash.update(readFileSync(path));
  }
  return hash.digest("hex");
}

async function caller(cwd: string, model: string, sandbox: string) {
  const restricted = sandbox === "read-only";
  const prompt = `This disposable synthetic repository is a Degreaser caller-permission check.
Use your native command tool to run exactly: ${command} review --scope worktree --task 'Review the synthetic addition' --aspects low-value-comments --wait 1
Do not edit anything. Do not run your own review. Do not use additional permissions, escalation, rules, network tools, delegation or configuration changes.
${
  restricted
    ? `If the command is blocked, do not retry or work around it. Run ${command} home and ${command} report to demonstrate local reads, then finish.`
    : `If it returns running or yields a command session, wait for that same session/run. Use ${command} wait <the-run-id> --wait 60 until terminal. Then run ${command} report and finish.`
}
Your final answer should state only the observed status and exit code.`;
  const env = Object.fromEntries(
    INHERITED_WORKER_ENV.flatMap((key) =>
      process.env[key] ? [[key, process.env[key]]] : [],
    ),
  );
  const child = spawn(
    "codex",
    [
      "--ask-for-approval",
      "never",
      "exec",
      "--model",
      model,
      "--sandbox",
      sandbox,
      "--ignore-user-config",
      "--ignore-rules",
      "--ephemeral",
      "--json",
      // Native full-access thread/start otherwise persists trust for a new cwd.
      "-c",
      `projects={ ${JSON.stringify(cwd)} = { trust_level = "untrusted" } }`,
      "-c",
      "project_doc_max_bytes=0",
      "-c",
      "features.hooks=false",
      "-c",
      "features.multi_agent=false",
      "-c",
      "features.code_mode_host=true",
      "-c",
      'web_search="disabled"',
      prompt,
    ],
    { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  const closed = once(child, "close");
  const stop = () => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  let buffer = "",
    bytes = 0;
  const observations: {
    command: string;
    exit: number | null;
    running: boolean;
    completed: boolean;
    permission: boolean;
    authorizedAction: boolean;
    localRead: boolean;
  }[] = [];
  const eventTypes = new Set<string>();
  let thread: string | undefined,
    escalated = false,
    timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, 240_000);
  child.stderr.on("data", () => {}); // Native diagnostics can include private configuration.
  child.stdout.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > 4_194_304) {
      stop();
      return;
    }
    buffer += chunk.toString("utf8");
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n");
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let e: {
        type?: string;
        thread_id?: string;
        item?: {
          type?: string;
          command?: string;
          exit_code?: number;
          aggregated_output?: string;
        };
      };
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof e.type === "string") eventTypes.add(e.type);
      if (typeof e.thread_id === "string") thread = e.thread_id;
      const item = e.item;
      if (item?.type !== "command_execution") continue;
      escalated ||= /require_escalated/.test(JSON.stringify(item));
      if (e.type !== "item.completed") continue;
      const output = String(item.aggregated_output ?? "");
      observations.push({
        command: String(item.command ?? ""),
        exit: item.exit_code ?? null,
        running: /status: running/.test(output),
        completed: /status: completed/.test(output),
        permission:
          /environment-blocked/.test(output) &&
          /diagnosis: permission/.test(output),
        authorizedAction: /authorized session/.test(output),
        localRead:
          /status: completed/.test(output) || /history: available/.test(output),
      });
    }
  });
  try {
    const [exit] = await closed;
    console.log(
      JSON.stringify({
        case: "caller-permissions",
        model,
        sandbox,
        thread,
        exit,
        timedOut,
        escalated,
        eventTypes: [...eventTypes],
        observations,
      }),
    );
    assert.equal(exit, 0);
    assert.equal(timedOut, false);
    assert.equal(escalated, false);
    const reviews = observations.filter((o) =>
      o.command.includes("review --scope"),
    );
    assert.equal(
      reviews.length,
      1,
      "Caller must execute exactly one review command.",
    );
    if (restricted) {
      assert.equal(reviews[0]?.exit, 2);
      assert.equal(reviews[0]?.permission, true);
      assert.equal(reviews[0]?.authorizedAction, true);
      assert.ok(
        observations.some((o) => /\bhome\b/.test(o.command) && o.localRead),
      );
      assert.ok(
        observations.some((o) => /\breport\b/.test(o.command) && o.completed),
      );
    } else {
      assert.ok(observations.some((o) => o.completed));
    }
  } finally {
    clearTimeout(timer);
    stop();
  }
}

export async function liveCallerPermissions(model: string) {
  if (model !== "gpt-6-luna")
    throw new Error("This fixture is approved only for Codex gpt-6-luna.");
  const cwd = await realpath(
    await mkdtemp(join(tmpdir(), "degreaser-caller-permissions-")),
  );
  const before = policySnapshot();
  const state = () => {
    const path = join(cwd, ".degreaser/state.json");
    if (!existsSync(path)) return undefined;
    const latest = JSON.parse(readFileSync(path, "utf8")).latestRunId;
    return JSON.parse(
      readFileSync(join(cwd, ".degreaser/runs", latest, "run.json"), "utf8"),
    ) as Run;
  };
  try {
    for (const args of [
      ["init", "--initial-branch=main"],
      ["commit", "--allow-empty", "-m", "Synthetic baseline"],
    ]) {
      const result = spawnSync("git", args, { cwd, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
    await writeFile(
      join(cwd, ".gitignore"),
      "/.degreaser/\n.degreaserrc.json\n",
    );
    await writeFile(
      join(cwd, ".degreaserrc.json"),
      JSON.stringify({
        agent: "codex",
        model,
        maxRetries: 0,
        limits: { workerTimeoutSeconds: 120, runTimeoutSeconds: 180 },
      }),
    );
    const source = "export const add = (a: number, b: number) => a + b;\n";
    await writeFile(join(cwd, "source.ts"), source);
    const index = existsSync(join(cwd, ".git/index"))
      ? readFileSync(join(cwd, ".git/index"))
      : null;
    await caller(cwd, model, "danger-full-access");
    assert.equal(
      policySnapshot(),
      before,
      "Authorized caller must not persist host policy.",
    );
    const run = state();
    assert.equal(run?.status, "completed");
    assert.equal(run?.tasks.length, 1);
    assert.equal(run?.tasks[0]?.assignment.model, model);
    assert.equal(run?.tasks[0]?.attempts.length, 1);
    const runBefore = JSON.stringify(run);
    // A new object write is required, so the read-only caller hits a real denial.
    await writeFile(
      join(cwd, "source.ts"),
      `${source}export const zero = 0;\n`,
    );
    await caller(cwd, model, "read-only");
    assert.equal(JSON.stringify(state()), runBefore);
    assert.equal(
      readFileSync(join(cwd, "source.ts"), "utf8"),
      `${source}export const zero = 0;\n`,
    );
    assert.deepEqual(
      existsSync(join(cwd, ".git/index"))
        ? readFileSync(join(cwd, ".git/index"))
        : null,
      index,
    );
    assert.equal(
      policySnapshot(),
      before,
      "Restricted caller must not persist host policy.",
    );
    console.log(
      JSON.stringify({
        run: run?.id,
        workerSession: run?.tasks[0]?.attempts[0]?.sessionId,
        globalPolicyUnchanged: true,
        restrictedHistoryUnchanged: true,
        sourceUnchanged: true,
        indexUnchanged: true,
      }),
    );
  } finally {
    if ((await stopRuns(cwd, [cli])).length === 0)
      await rm(cwd, { recursive: true, force: true });
    else {
      console.error(
        `Caller permission cleanup could not confirm owner exit; fixture retained at ${cwd}.`,
      );
      process.exitCode = 1;
    }
  }
}
