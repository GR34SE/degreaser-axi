export function slots(limit: number) {
  let active = 0;
  let warmed = false;
  const waiting: (() => void)[] = [];
  const pump = () => {
    while (waiting.length && active < (warmed ? limit : 1)) {
      active++;
      waiting.shift()?.();
    }
  };
  return {
    warm() {
      warmed = true;
      pump();
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
