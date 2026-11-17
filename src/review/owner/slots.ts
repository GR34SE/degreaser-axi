const WARM_UP_MS = 15_000;

export function slots(limit: number, warmUpMs = WARM_UP_MS) {
  let active = 0;
  let reduced = false;
  let warmed = false;
  let timer: NodeJS.Timeout | undefined;
  const waiting: (() => void)[] = [];
  const pump = () => {
    while (waiting.length && active < (warmed ? limit : 1)) {
      active++;
      if (!warmed) {
        clearTimeout(timer);
        timer = setTimeout(warm, warmUpMs).unref();
      }
      waiting.shift()?.();
    }
  };
  const warm = () => {
    clearTimeout(timer);
    warmed = true;
    pump();
  };
  return {
    warm,
    halve() {
      if (!reduced) {
        limit = Math.max(1, Math.floor(limit / 2));
        reduced = true;
      }
      return limit;
    },
    async acquire() {
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
        pump();
      });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active--;
        pump();
      };
    },
  };
}
export type Slots = ReturnType<typeof slots>;
