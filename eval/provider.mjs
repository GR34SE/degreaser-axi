import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { decode } from "@toon-format/toon";
import { reserveSessions } from "./admissions.mjs";
import { productIdentity } from "./product-identity.mjs";
import { environment, execute, git } from "./provider-process.mjs";
import { materialize, validateSample } from "./provider-sample.mjs";
import reviewPolicy from "./review-policy.json" with { type: "json" };

const codes = {
  completed: 0,
  partial: 1,
  failed: 1,
  interrupted: 1,
  running: 3,
};
const json = (result) => {
  try {
    return JSON.parse(result.stdout.toString());
  } catch {
    throw new Error("Public CLI returned invalid JSON.");
  }
};
function report(result) {
  // Public commands use AXI's TOON; only export emits JSON. There is no --json flag.
  let value;
  try {
    value = decode(result.stdout.toString());
  } catch {
    throw new Error("Public CLI returned invalid TOON.");
  }
  if (
    !Object.hasOwn(codes, value.status) ||
    result.code !== codes[value.status] ||
    typeof value.run !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(value.run)
  ) {
    throw new Error("Public CLI returned an invalid review outcome.");
  }
  return value;
}

async function savedRun(root) {
  const state = join(root, ".degreaser/state.json");
  if (!existsSync(state)) return null;
  const { latestRunId } = JSON.parse(await readFile(state, "utf8"));
  if (
    typeof latestRunId !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(latestRunId)
  ) {
    throw new Error("Invalid saved evaluation run.");
  }
  return latestRunId;
}

async function release(root, cli, env, runId) {
  const run = runId ?? (await savedRun(root));
  if (!run) return;
  const result = report(
    await execute(process.execPath, [cli, "cancel", run], {
      cwd: root,
      env,
      timeoutMs: 30_000,
    }),
  );
  if (result.status === "running")
    throw new Error("Evaluation cancellation did not finish.");
  const directory = join(root, ".degreaser/runs", run);
  const until = Date.now() + 3000;
  while (existsSync(join(directory, "owner.lock")) && Date.now() < until)
    await delay(25);
  const saved = JSON.parse(await readFile(join(directory, "run.json"), "utf8"));
  if (
    existsSync(join(directory, "owner.lock")) ||
    saved.owner?.processes?.length
  ) {
    throw new Error("Evaluation owner cleanup is unresolved.");
  }
}

export default class DegreaserProvider {
  constructor({ id, config } = {}) {
    if (
      !config ||
      !isAbsolute(config.productDir ?? "") ||
      !["claude", "codex", "pi", "cursor"].includes(config.agent) ||
      typeof config.model !== "string" ||
      !/^\S+$/.test(config.model) ||
      !Number.isSafeInteger(config.timeoutMs ?? 900_000) ||
      (config.timeoutMs ?? 900_000) < 1 ||
      (config.timeoutMs ?? 900_000) > 2_147_483_647
    ) {
      throw new Error(
        "Provider requires productDir, exact agent/model and a positive timeoutMs.",
      );
    }
    this.config = config;
    this.providerId = id ?? `degreaser:${config.agent}:${config.model}`;
  }

  id() {
    return this.providerId;
  }

  async callApi(_prompt, context) {
    const started = Date.now();
    let root, runId, envelope, failure, cleanupFailed;
    const { productDir, agent, model, timeoutMs = 900_000 } = this.config;
    let env;
    const cli = join(productDir, "dist/main.js");
    const remaining = () => started + timeoutMs - Date.now();
    try {
      const sample = context?.vars?.sample;
      validateSample(sample);
      if (this.config.budgetFile)
        reserveSessions(
          this.config.budgetFile,
          this.config.sessionBudget,
          sample.aspects.length,
        );
      env = {
        ...environment(this.config.env),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      };
      const product = await realpath(productDir);
      const source = await realpath(sample.repo.directory);
      root = await realpath(await mkdtemp(join(tmpdir(), "degreaser-eval-")));
      if (
        [product, source].some(
          (directory) => root === directory || root.startsWith(`${directory}/`),
        )
      ) {
        throw new Error(
          "Evaluation temp must be outside the product and source.",
        );
      }
      const schema = JSON.parse(
        await readFile(join(product, "dist/config/config.schema.json"), "utf8"),
      );
      const aspects = schema.definitions.aspect.enum;
      if (sample.aspects.some((aspect) => !aspects.includes(aspect)))
        throw new Error("Unknown evaluation aspect.");
      const productSha = (
        await git(product, ["rev-parse", "HEAD"], {
          env,
          timeoutMs: remaining(),
        })
      )
        .toString()
        .trim();
      const productHash = await productIdentity(product);
      const materialized = await materialize(sample, root, {
        env,
        get timeoutMs() {
          return remaining();
        },
      });
      await writeFile(
        join(root, ".degreaserrc.json"),
        JSON.stringify({
          ...reviewPolicy,
          agent,
          model,
          aspects: Object.fromEntries(
            aspects.map((aspect) => [aspect, sample.aspects.includes(aspect)]),
          ),
        }),
      );
      const invoke = (args) =>
        execute(process.execPath, [cli, ...args], {
          cwd: root,
          env,
          timeoutMs: remaining(),
          maxBytes: 16_777_216,
          preserveChildren: () =>
            existsSync(join(root, ".degreaser/state.json")),
        });
      const args = [
        "review",
        "--scope",
        sample.review.scope,
        "--task",
        sample.review.task,
        "--aspects",
        sample.aspects.join(","),
        "--wait",
        "1",
      ];
      if (sample.review.scope === "branch")
        args.push("--base", materialized.base);
      for (const path of sample.review.paths ?? []) args.push("--path", path);
      let result = report(await invoke(args));
      runId = result.run;
      let waitCount = 0;
      while (result.status === "running") {
        result = report(await invoke(["wait", runId, "--wait", "1"]));
        if (result.run !== runId)
          throw new Error("Public CLI changed run identity.");
        waitCount++;
      }
      if (!["completed", "partial"].includes(result.status))
        throw new Error(`Review ended ${result.status}.`);
      const exported = await invoke(["export", runId]);
      const data = json(exported);
      if (
        exported.code !== 0 ||
        data.schemaVersion !== 1 ||
        data.run !== runId ||
        data.status !== result.status ||
        !Array.isArray(data.findings) ||
        !Array.isArray(data.coverage) ||
        data.coverage.length !== sample.aspects.length ||
        new Set(data.coverage.map((row) => row.aspect)).size !==
          sample.aspects.length ||
        data.coverage.some((row) => !sample.aspects.includes(row.aspect)) ||
        (data.status === "completed" &&
          data.coverage.some(
            (row) =>
              !["findings", "no-findings", "not-applicable"].includes(
                row.status,
              ),
          ))
      ) {
        throw new Error("Public export does not match the terminal review.");
      }
      const full = report(await invoke(["report", runId, "--full"]));
      if (
        full.run !== runId ||
        full.status !== result.status ||
        !Array.isArray(full.execution) ||
        !Array.isArray(full.configuration) ||
        full.configuration.some(
          (row) => row.agent !== agent || row.model !== model,
        )
      )
        throw new Error("Invalid full public report.");
      const sessionCount = full.execution.reduce(
        (sum, row) =>
          sum +
          row.attempts.filter(
            (attempt) => typeof attempt.sessionId === "string",
          ).length,
        0,
      );
      envelope = {
        sampleId: sample.id,
        export: data,
        meta: {
          productSha,
          productHash,
          agent,
          model,
          sampleHash: materialized.sampleHash,
          sessionCount,
          waitCount,
        },
      };
      if (productHash !== (await productIdentity(product)))
        throw new Error("Built product changed during evaluation.");
    } catch (error) {
      failure = error instanceof Error ? error.message : "Evaluation failed.";
      cleanupFailed = error?.cleanupFailed;
    }
    if (root) {
      try {
        if (env) await release(root, cli, env, runId);
        if (!cleanupFailed) await rm(root, { recursive: true, force: true });
      } catch {
        cleanupFailed = true;
      }
      if (cleanupFailed) {
        failure = `Evaluation cleanup failed; source and ownership state retained at ${root}. Run the public cancel command there before removing it.`;
      }
    }
    if (failure) return { error: failure };
    envelope.meta.durationMs = Date.now() - started;
    return { output: JSON.stringify(envelope) };
  }
}
