import test from "node:test";
import assert from "node:assert/strict";
import { createPlanRevisionPolicy } from "../../extensions/clarification-orchestrator/workflow/adapters/plan-review/revision-controller.ts";
import type { PlanReviewAggregate, PlanReviewArtifactBinding, PlanReviewFinding } from "../../extensions/clarification-orchestrator/workflow/adapters/plan-review/types.ts";

const ref = { kind: "design" as const, version: 1, path: "d", checksum: "c", createdAt: "t" };
const binding: PlanReviewArtifactBinding = { design: ref, approvedDesignRef: ref, requirements: { ...ref, kind: "requirements" }, tasks: { ...ref, kind: "tasks" }, createdAt: "t" };
const finding: PlanReviewFinding = { id: "f", reviewRunId: "r", reviewerRole: "shape-validator", artifactBinding: binding, severity: "blocking", category: "requirements-coverage", title: "x", description: "x", affectedArtifacts: ["design"], affectedSections: [], recommendation: "Revise design", requiresPlanRevision: false, requiresDesignRevision: true };

test("design blocker prevents automatic plan revision", () => {
  const aggregate: PlanReviewAggregate = { reviewRunId: "r", artifactBinding: binding, findings: [finding], reviewerResults: [], counts: { blocking: 1, major: 0, minor: 0, note: 0, requiresPlanRevision: 0, requiresDesignRevision: 1 } };
  assert.equal(createPlanRevisionPolicy({ revisionId: "rev", aggregate, readiness: { status: "blocked-needs-plan-revision", blockingFindingIds: ["f"], summary: "x" }, alreadyUsed: false }).reason, "requires-design-revision");
});
