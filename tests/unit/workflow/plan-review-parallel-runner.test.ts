import assert from "node:assert/strict";
import test from "node:test";
import { getFixedPlanReviewers } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/reviewer-registry.ts";
import { planReviewerOutputSchema } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/schemas.ts";

// The runner is intentionally thin over runAgent; these unit checks cover the fixed inputs and fail-closed schema behavior
// without spawning child Pi processes.

test("parallel runner uses all fixed reviewers as the only allowed concurrency set", () => {
  const roles = getFixedPlanReviewers();
  assert.equal(roles.length, 3);
  assert.deepEqual(new Set(roles), new Set(["requirements-coverage-reviewer", "task-coverage-reviewer", "dependency-order-reviewer"]));
});

test("parallel runner schema treats invalid reviewer output as whole-review failure input", () => {
  assert.throws(() => planReviewerOutputSchema.validate({ summary: "x", confidence: "high", findings: [{ severity: "critical" }] }), /severity/u);
  assert.throws(() => planReviewerOutputSchema.validate({ summary: "x", confidence: "high", findings: [], approval: true }), /unauthorized directive/u);
});
