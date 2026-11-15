import assert from "node:assert/strict";
import test from "node:test";
import { slots } from "./slots.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("one worker warms up alone, then the run-wide limit applies", async () => {
  const limiter = slots(2);
  const granted: number[] = [];
  const releases = new Map<number, () => void>();
  for (const id of [1, 2, 3, 4])
    void limiter.acquire().then((release) => {
      granted.push(id);
      releases.set(id, release);
    });
  await tick();
  assert.deepEqual(granted, [1]);
  limiter.warm();
  await tick();
  assert.deepEqual(granted, [1, 2]);
  releases.get(1)?.();
  releases.get(1)?.();
  await tick();
  assert.deepEqual(granted, [1, 2, 3]);
});

test("a warm-up worker that ends before its first turn hands warm-up to the next", async () => {
  const limiter = slots(Infinity);
  const granted: number[] = [];
  const releases = new Map<number, () => void>();
  for (const id of [1, 2, 3])
    void limiter.acquire().then((release) => {
      granted.push(id);
      releases.set(id, release);
    });
  await tick();
  releases.get(1)?.();
  await tick();
  assert.deepEqual(granted, [1, 2]);
  limiter.warm();
  await tick();
  assert.deepEqual(granted, [1, 2, 3]);
});
