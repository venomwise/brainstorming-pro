import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { bindPlanReviewArtifacts, isPlanReviewBindingStale } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/artifact-binding.ts";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import type { WorkflowState } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

async function fixture() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-plan-binding-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const design = await writeVersionedArtifact(layout, "design", "# Design");
  const requirements = await writeVersionedArtifact(layout, "requirements", "# Requirements");
  const tasks = await writeVersionedArtifact(layout, "tasks", "# Tasks");
  const state = { artifacts: { design, requirements, tasks }, gates: { design: { gate: "design", artifacts: [design], approvedBy: "user", approvedAt: new Date().toISOString(), path: ".workflow/approvals/design.json" } } } as WorkflowState;
  return { layout, state, design, requirements, tasks };
}

test("bindPlanReviewArtifacts binds valid approved design and current plan artifacts", async () => {
  const { layout, state, design, requirements, tasks } = await fixture();
  const result = await bindPlanReviewArtifacts(layout, state);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.binding.design, design);
  assert.deepEqual(result.binding.requirements, requirements);
  assert.deepEqual(result.binding.tasks, tasks);
  assert.equal(result.contents.design, "# Design");
});

test("bindPlanReviewArtifacts fails closed without design approval", async () => {
  const { layout, state } = await fixture();
  state.gates = {};
  const result = await bindPlanReviewArtifacts(layout, state);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "missing-design-approval");
});

test("bindPlanReviewArtifacts fails on checksum mismatch and path traversal", async () => {
  const { layout, state, requirements } = await fixture();
  state.artifacts.requirements = { ...requirements, checksum: "bad" };
  const mismatch = await bindPlanReviewArtifacts(layout, state);
  assert.equal(mismatch.ok, false);
  state.artifacts.requirements = { ...requirements, path: "../escape.md" };
  const escape = await bindPlanReviewArtifacts(layout, state);
  assert.equal(escape.ok, false);
});

test("isPlanReviewBindingStale detects changed artifact refs", async () => {
  const { layout, state } = await fixture();
  const result = await bindPlanReviewArtifacts(layout, state);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(await isPlanReviewBindingStale(layout, result.binding, state), false);
  const newTasks = await writeVersionedArtifact(layout, "tasks", "# Tasks v2");
  state.artifacts.tasks = newTasks;
  assert.equal(await isPlanReviewBindingStale(layout, result.binding, state), true);
});
