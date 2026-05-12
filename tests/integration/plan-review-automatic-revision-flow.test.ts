import test from "node:test";
import assert from "node:assert/strict";
import { createPlanRevisionPolicy } from "../../extensions/clarification-orchestrator/workflow/adapters/plan-review/revision-controller.ts";
import type { PlanReviewAggregate, PlanReviewArtifactBinding } from "../../extensions/clarification-orchestrator/workflow/adapters/plan-review/types.ts";

const ref = { kind: "design" as const, version: 1, path: "d", checksum: "c", createdAt: "t" };
const binding: PlanReviewArtifactBinding = { design: ref, approvedDesignRef: ref, requirements: { ...ref, kind: "requirements", version: 1 }, tasks: { ...ref, kind: "tasks", version: 1 }, createdAt: "t" };
const aggregate: PlanReviewAggregate = { reviewRunId: "review-1", artifactBinding: binding, findings: [], reviewerResults: [], counts: { blocking: 0, major: 0, minor: 0, note: 0, requiresPlanRevision: 0, requiresDesignRevision: 0 } };

test("automatic plan revision is one-shot for a plan cycle", () => {
  assert.equal(createPlanRevisionPolicy({ revisionId: "rev-1", aggregate, readiness: { status: "blocked-needs-plan-revision", blockingFindingIds: [], summary: "x" }, alreadyUsed: false }).eligible, true);
  assert.equal(createPlanRevisionPolicy({ revisionId: "rev-2", aggregate, readiness: { status: "blocked-needs-plan-revision", blockingFindingIds: [], summary: "x" }, alreadyUsed: true }).eligible, false);
});
