import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowRuntimeOrchestrator, createInitialWorkflowState, saveWorkflowState } from "../../extensions/clarification-orchestrator/workflow/runtime.ts";
import type { WorkflowAdapter } from "../../extensions/clarification-orchestrator/workflow/runtime.ts";

async function tempProject() { return fs.mkdtemp(path.join(os.tmpdir(), "bp-plan-auto-")); }

test("automatic plan review flow has no implicit skip path", async () => {
  const cwd = await tempProject();
  const adapter: WorkflowAdapter = { run: (state) => ({ ...state, phase: "awaiting-plan-approval", reviewStatus: { plan: { target: "plan", mode: "minimal", status: "passed", artifacts: [], readinessStatus: "ready-for-plan-approval", planReview: { automatic: true, reviewRunId: "r", ledgerPath: "l", readinessStatus: "ready-for-plan-approval", reviewedArtifacts: [] } } } }) };
  const runtime = new WorkflowRuntimeOrchestrator(cwd, { adapters: { "plan-review": adapter } });
  await saveWorkflowState(cwd, { ...createInitialWorkflowState({ topic: "my-topic", request: "x", runId: "run-1" }), phase: "plan-review" });
  const state = await runtime.resumeWorkflow("my-topic");
  assert.equal("phase" in state && state.phase, "awaiting-plan-approval");
  assert.equal("pendingDecision" in state && state.pendingDecision?.type, "approval");
});
