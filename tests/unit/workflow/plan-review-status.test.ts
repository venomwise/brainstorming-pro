import assert from "node:assert/strict";
import test from "node:test";
import { createInitialWorkflowState, renderWorkflowStatus } from "../../../extensions/clarification-orchestrator/workflow/runtime.ts";

const requirements = { kind: "requirements" as const, version: 1, path: "r", checksum: "r", createdAt: "t" };
const tasks = { kind: "tasks" as const, version: 1, path: "t", checksum: "t", createdAt: "t" };

test("renderWorkflowStatus presents automatic plan review next action", () => {
  const state = createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" });
  const status = renderWorkflowStatus({ ...state, phase: "awaiting-plan-approval", reviewStatus: { plan: { target: "plan", mode: "minimal", status: "passed", artifacts: [requirements, tasks], planReview: { automatic: true, reviewRunId: "review-1", ledgerPath: ".workflow/reviews/plan/review-1", readinessStatus: "ready-for-plan-approval", reviewedArtifacts: [requirements, tasks] } } } });
  assert.equal(status.planReviewStatus?.nextAction, "approve-plan");
  assert.equal(status.planReviewStatus?.ledgerPath, ".workflow/reviews/plan/review-1");
});
