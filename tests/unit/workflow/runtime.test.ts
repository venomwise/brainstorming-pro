import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowRuntimeOrchestrator, createInitialWorkflowState, saveWorkflowState, startWorkflow } from "../../../extensions/clarification-orchestrator/workflow/runtime.ts";
import type { VersionedArtifactRef } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

async function tempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bp-runtime-"));
}

const designRef: VersionedArtifactRef = { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "abc", createdAt: "2026-05-08T00:00:00.000Z" };

test("starts a workflow with isolated state", async () => {
  const cwd = await tempProject();
  const { state } = await startWorkflow({ cwd, topic: "my-topic", request: "Build feature", runId: "run-1" });
  assert.equal(state.phase, "designing");
  assert.equal(state.runId, "run-1");
});

test("renders review decision and applies skip", async () => {
  const cwd = await tempProject();
  const state = createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" });
  await saveWorkflowState(cwd, { ...state, phase: "awaiting-design-review-decision", artifacts: { design: designRef } });
  const runtime = new WorkflowRuntimeOrchestrator(cwd);
  const pending = await runtime.resumeWorkflow("my-topic");
  assert.equal("phase" in pending && pending.phase, "awaiting-design-review-decision");
  assert.equal("pendingDecision" in pending && pending.pendingDecision?.type, "review-decision");
  const advanced = await runtime.resumeWorkflow("my-topic", { type: "review-mode", mode: "skip", user: "tester" });
  assert.equal("phase" in advanced && advanced.phase, "awaiting-design-approval");
});

test("full review remains unavailable at decision gate", async () => {
  const cwd = await tempProject();
  const state = createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" });
  await saveWorkflowState(cwd, { ...state, phase: "awaiting-design-review-decision", artifacts: { design: designRef } });
  const result = await new WorkflowRuntimeOrchestrator(cwd).resumeWorkflow("my-topic", { type: "review-mode", mode: "full", user: "tester" });
  assert.equal("phase" in result && result.phase, "awaiting-design-review-decision");
  assert.equal("reviewStatus" in result && result.reviewStatus.design?.status, "unavailable");
});

test("approval advances design gate to planning", async () => {
  const cwd = await tempProject();
  const state = createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" });
  await saveWorkflowState(cwd, { ...state, phase: "awaiting-design-approval", artifacts: { design: designRef } });
  const result = await new WorkflowRuntimeOrchestrator(cwd).resumeWorkflow("my-topic", { type: "approval", action: "approve", user: "tester" });
  assert.equal("phase" in result && result.phase, "planning");
});
