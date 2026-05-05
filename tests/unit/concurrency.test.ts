import test from "node:test";
import assert from "node:assert/strict";
import { Semaphore, runBounded, shouldReduceConcurrencyForRateLimits } from "../../extensions/clarification-orchestrator/concurrency.ts";

test("Semaphore preserves order and concurrency limit", async () => {
  const semaphore = new Semaphore(2);
  const active: number[] = [];
  const maxSeen: number[] = [];
  let current = 0;
  const results = await runBounded([1, 2, 3, 4], semaphore.concurrency, async (item) => {
    current += 1;
    active.push(item);
    maxSeen.push(current);
    await new Promise((resolve) => setTimeout(resolve, 1));
    current -= 1;
    return item * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8]);
  assert.equal(Math.max(...maxSeen), 2);
  assert.deepEqual(active, [1, 2, 3, 4]);
});

test("Semaphore can reduce concurrency after rate limits", () => {
  const semaphore = new Semaphore(4);
  assert.equal(semaphore.reduceConcurrency(), 3);
  assert.equal(semaphore.reduceConcurrency(2), 2);
  assert.equal(shouldReduceConcurrencyForRateLimits(["rate-limit", "subagent", "rate-limit"]), true);
  assert.equal(shouldReduceConcurrencyForRateLimits(["subagent", "timeout"]), false);
});
