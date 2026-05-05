import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bundledDefaults } from "../../extensions/clarification-orchestrator/config.ts";
import { buildCleanupPlan, executeCleanupPlan } from "../../extensions/clarification-orchestrator/retention.ts";
import { resolveSpecPaths } from "../../extensions/clarification-orchestrator/path-guard.ts";

async function setupTopic() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-clean-"));
  const topic = resolveSpecPaths(cwd, "Topic");
  for (const run of ["run-1", "run-2", "run-3", "run-4"]) await fs.mkdir(path.join(topic.clarificationDir, run), { recursive: true });
  return topic;
}

test("buildCleanupPlan protects newest keep runs", async () => {
  const topic = await setupTopic();
  const plan = await buildCleanupPlan(topic, bundledDefaults, 2);
  assert.deepEqual(plan.protectedRuns, ["run-3", "run-4"]);
  assert.deepEqual(plan.deleteRuns, ["run-1", "run-2"]);
});

test("executeCleanupPlan dry run deletes nothing", async () => {
  const topic = await setupTopic();
  const plan = await buildCleanupPlan(topic, bundledDefaults, 2);
  const result = await executeCleanupPlan(topic, plan, true);
  assert.deepEqual(result.deleted, []);
  assert.ok(await fs.stat(path.join(topic.clarificationDir, "run-1")));
});

test("executeCleanupPlan deletes planned runs", async () => {
  const topic = await setupTopic();
  const plan = await buildCleanupPlan(topic, bundledDefaults, 2);
  const result = await executeCleanupPlan(topic, plan, false);
  assert.deepEqual(result.deleted, ["run-1", "run-2"]);
});
