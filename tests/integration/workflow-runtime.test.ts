import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowRuntimeOrchestrator, createInitialWorkflowState, saveWorkflowState } from "../../extensions/clarification-orchestrator/workflow/runtime.ts";
import type { VersionedArtifactRef } from "../../extensions/clarification-orchestrator/workflow/types.ts";

async function tempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bp-workflow-int-"));
}

const design: VersionedArtifactRef = { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "d", createdAt: "2026-05-08T00:00:00.000Z" };
const requirements: VersionedArtifactRef = { kind: "requirements", version: 1, path: ".workflow/artifacts/requirements/v1.md", checksum: "r", createdAt: "2026-05-08T00:00:00.000Z" };
const tasks: VersionedArtifactRef = { kind: "tasks", version: 1, path: ".workflow/artifacts/tasks/v1.md", checksum: "t", createdAt: "2026-05-08T00:00:00.000Z" };

test("runtime happy path through review and approval gates", async () => {
  const cwd = await tempProject();
  const runtime = new WorkflowRuntimeOrchestrator(cwd);
  const initial = createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" });
  await saveWorkflowState(cwd, { ...initial, phase: "awaiting-design-review-decision", artifacts: { design } });
  await runtime.resumeWorkflow("my-topic", { type: "review-mode", mode: "skip", user: "u" });
  const designReviewed = await runtime.resumeWorkflow("my-topic");
  assert.equal("phase" in designReviewed && designReviewed.phase, "awaiting-design-approval");
  await runtime.resumeWorkflow("my-topic", { type: "approval", action: "approve", user: "u" });
  const designApproved = await runtime.resumeWorkflow("my-topic");
  assert.equal("phase" in designApproved && designApproved.phase, "planning");
  const planning = createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" });
  await saveWorkflowState(cwd, { ...planning, phase: "awaiting-plan-review-decision", artifacts: { design, requirements, tasks } });
  const planReviewed = await runtime.resumeWorkflow("my-topic", { type: "review-mode", mode: "skip", user: "u" });
  assert.equal("phase" in planReviewed && planReviewed.phase, "awaiting-plan-approval");
  const approved = await runtime.resumeWorkflow("my-topic", { type: "approval", action: "approve", user: "u" });
  assert.equal("phase" in approved && approved.phase, "executing");
});
