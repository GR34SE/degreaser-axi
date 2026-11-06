// Opt-in observation only. The compiled runtime, profiles, adapters and results
// are unchanged; no prompt, native output, environment or tool payload is saved.
import { appendFileSync } from "node:fs";
import { registerHooks } from "node:module";

export async function observeWorker(request, profile, execute) {
  const aspect = /Assigned aspect: ([a-z-]+)/.exec(request.prompt)?.[1];
  if (!aspect) throw new Error("Fleet observer could not identify assignment");
  const record = (type, fields = {}) =>
    appendFileSync(
      process.env.DEGREASER_FLEET_TRACE,
      `${JSON.stringify({ time: Date.now(), aspect, agent: profile.agent, model: profile.model, type, ...fields })}\n`,
      { mode: 0o600 },
    );
  record("start", {
    adapterVersion: profile.adapterVersion,
    nativeVersion: profile.nativeVersion,
  });
  try {
    const outcome = await execute(
      {
        ...request,
        onSessionReady(id) {
          record("session", { sessionId: id });
          request.onSessionReady?.(id);
        },
        onPromptStarted() {
          record("prompt");
          request.onPromptStarted?.();
        },
        onLifecycle(event) {
          record(event.type, { pid: event.pid });
          request.onLifecycle?.(event);
        },
      },
      profile,
    );
    record("outcome", {
      failure: outcome.failure ?? null,
      cleanupFailed: outcome.cleanupFailed,
    });
    return outcome;
  } finally {
    record("end");
  }
}

const runtime = new URL("../dist/src/worker-runtime.js", import.meta.url).href;
registerHooks({
  load(url, context, nextLoad) {
    if (url !== runtime) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: `
        export * from ${JSON.stringify(`${runtime}?fleet-original`)};
        import { executeWorker as execute } from ${JSON.stringify(`${runtime}?fleet-original`)};
        import { observeWorker } from ${JSON.stringify(import.meta.url)};
        export const executeWorker = (request, profile) => observeWorker(request, profile, execute);
      `,
    };
  },
});
