import assert from "node:assert/strict";
import test from "node:test";
import { renderExpandedWorkflowSnapshot } from "../../extensions/clarification-orchestrator/tui/workflow-widget.ts";
import type { WorkflowLiveSnapshot } from "../../extensions/clarification-orchestrator/workflow/progress-types.ts";

function planReviewSnapshot(): WorkflowLiveSnapshot {
  return {
    topic: "live-progress",
    runId: "run-1",
    phase: "awaiting-plan-approval",
    phaseStatus: "awaiting-user",
    version: 1,
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:01:00.000Z",
    stale: false,
    fallbackText: "Awaiting plan approval.",
    timeline: [],
    artifacts: [],
    agents: [],
    reviewers: [
      { reviewRunId: "plan-review-1", target: "plan", reviewerId: "requirements-coverage-reviewer", status: "passed" },
      { reviewRunId: "plan-review-1", target: "plan", reviewerId: "task-coverage-reviewer", status: "passed" },
      { reviewRunId: "plan-review-1", target: "plan", reviewerId: "dependency-order-reviewer", status: "passed" },
    ],
    tasks: [],
    gates: [{ id: "plan-approval", gate: "plan-approval", title: "Plan approval required", status: "awaiting-user", artifacts: [], safeCommands: ["/brainstorm-pro --resume live-progress"] }],
    diagnostics: [],
  };
}

test("plan review cards never expose mode, subset, partial accept, or per-reviewer retry controls", () => {
  const output = renderExpandedWorkflowSnapshot(planReviewSnapshot(), 120).join("\n");
  assert.doesNotMatch(output, /skip|minimal|full mode|choose reviewer|subset|partial accept|accept incomplete|retry reviewer/iu);
  assert.match(output, /requirements-coverage-reviewer/);
  assert.match(output, /task-coverage-reviewer/);
  assert.match(output, /dependency-order-reviewer/);
  assert.match(output, /Readiness is not approval/);
});
