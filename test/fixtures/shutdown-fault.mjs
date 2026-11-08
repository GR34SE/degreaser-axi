import { registerHooks } from "node:module";

const runtime = import.meta.resolve("acpx/runtime");
registerHooks({
  load(url, context, nextLoad) {
    if (url !== runtime) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: `
        export * from ${JSON.stringify(`${runtime}?actual`)};
        import { createAcpRuntime as create } from ${JSON.stringify(`${runtime}?actual`)};
        export function createAcpRuntime(options) {
          const runtime = create(options);
          const shutdown = runtime.shutdown.bind(runtime);
          runtime.shutdown = async () => {
            await shutdown();
            throw new Error("Synthetic shutdown failure; private-cleanup-diagnostic");
          };
          return runtime;
        }
      `,
    };
  },
});
