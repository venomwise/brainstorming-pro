import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowRuntimeOrchestrator, createInitialWorkflowState, saveWorkflowState } from "../../extensions/clarification-orchestrator/workflow/runtime.ts";

async function tempProject() { return fs.mkdtemp(path.join(os.tmpdir(), "bp-plan-stale-")); }

test("stale pre-revision artifacts cannot be approved", async () => {
  const cwd = await tempProject();
  const requirements = { kind: "requirements" as const, version: 2, path: "r2", checksum: "r2", createdAt: "t" };
  const tasks = { kind: "tasks" as const, version: 2, path: "t2", checksum: "t2", createdAt: "t" };
  const reviewedRequirements = { ...requirements, version: 1, path: "r1", checksum: "r1" };
  const reviewedTasks = { ...tasks, version: 1, path: "t1", checksum: "t1" };
  await saveWorkflowState(cwd, { ...createInitialWorkflowState({ topic: "my-topic", request: "x", runId: "run-1" }), phase: "awaiting-plan-approval", artifacts: { requirements, tasks }, reviewStatus: { plan: { target: "plan", mode: "minimal", status: "passed", artifacts: [reviewedRequirements, reviewedTasks], planReview: { automatic: true, reviewRunId: "r", ledgerPath: "l", readinessStatus: "ready-for-plan-approval", reviewedArtifacts: [reviewedRequirements, reviewedTasks] } } } });
  const runtime = new WorkflowRuntimeOrchestrator(cwd);
  await assert.rejects(() => runtime.resumeWorkflow("my-topic", { type: "approval", action: "approve", user: "u" }), /do not match/u);
});
