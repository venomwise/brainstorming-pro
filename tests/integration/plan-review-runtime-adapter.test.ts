import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkflowRuntimeOrchestrator, createInitialWorkflowState, saveWorkflowState } from "../../extensions/clarification-orchestrator/workflow/runtime.ts";
import type { WorkflowAdapter } from "../../extensions/clarification-orchestrator/workflow/runtime.ts";
import type { WorkflowState } from "../../extensions/clarification-orchestrator/workflow/types.ts";

async function tempProject() { return fs.mkdtemp(path.join(os.tmpdir(), "bp-plan-runtime-")); }

const design = { kind: "design" as const, version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "d", createdAt: "t" };
const requirements = { kind: "requirements" as const, version: 1, path: ".workflow/artifacts/requirements/v1.md", checksum: "r", createdAt: "t" };
const tasks = { kind: "tasks" as const, version: 1, path: ".workflow/artifacts/tasks/v1.md", checksum: "t", createdAt: "t" };
const planningAdapter: WorkflowAdapter = { run: () => ({ kind: "artifact-commit-request", artifacts: [{ kind: "requirements", content: "# Requirements" }, { kind: "tasks", content: "# Tasks" }] }) };
const readyPlanReviewAdapter: WorkflowAdapter = { run: (state: WorkflowState) => ({ ...state, phase: "awaiting-plan-approval", reviewStatus: { ...state.reviewStatus, plan: { target: "plan", mode: "minimal", status: "passed", artifacts: [state.artifacts.requirements!, state.artifacts.tasks!], readinessStatus: "ready-for-plan-approval", planReview: { automatic: true, reviewRunId: "review-1", ledgerPath: ".workflow/reviews/plan/review-1", readinessStatus: "ready-for-plan-approval", reviewedArtifacts: [state.artifacts.requirements!, state.artifacts.tasks!] } } } }) };

test("planning proceeds automatically to plan-review and then awaits plan approval", async () => {
  const cwd = await tempProject();
  const state = createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" });
  await saveWorkflowState(cwd, { ...state, phase: "planning", artifacts: { design }, gates: { design: { gate: "design", artifacts: [design], approvedBy: "u", approvedAt: "t", path: "p" } } });
  const runtime = new WorkflowRuntimeOrchestrator(cwd, { adapters: { planning: planningAdapter, "plan-review": readyPlanReviewAdapter } });
  const afterPlanning = await runtime.resumeWorkflow("my-topic");
  assert.equal("phase" in afterPlanning && afterPlanning.phase, "plan-review");
  const afterReview = await runtime.resumeWorkflow("my-topic");
  assert.equal("phase" in afterReview && afterReview.phase, "awaiting-plan-approval");
  assert.equal("pendingDecision" in afterReview && afterReview.pendingDecision?.type, "approval");
});

test("plan review mode input is ignored and execution requires ready reviewed artifacts plus approval", async () => {
  const cwd = await tempProject();
  const state = createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" });
  await saveWorkflowState(cwd, { ...state, phase: "plan-review", artifacts: { design, requirements, tasks } });
  const runtime = new WorkflowRuntimeOrchestrator(cwd, { adapters: { "plan-review": readyPlanReviewAdapter } });
  const ignored = await runtime.resumeWorkflow("my-topic", { type: "review-mode", mode: "skip", user: "u" });
  assert.equal("phase" in ignored && ignored.phase, "awaiting-plan-approval");
  const approved = await runtime.resumeWorkflow("my-topic", { type: "approval", action: "approve", user: "u" });
  assert.equal("phase" in approved && approved.phase, "executing");
});
