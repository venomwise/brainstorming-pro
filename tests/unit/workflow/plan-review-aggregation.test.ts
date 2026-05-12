import assert from "node:assert/strict";
import test from "node:test";
import { aggregatePlanReview } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/aggregation.ts";
import type { PlanReviewArtifactBinding, PlanReviewFinding } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/types.ts";

const ref = { kind: "design" as const, version: 1, path: "d", checksum: "c", createdAt: "t" };
const binding: PlanReviewArtifactBinding = { design: ref, approvedDesignRef: ref, requirements: { ...ref, kind: "requirements" }, tasks: { ...ref, kind: "tasks" }, createdAt: "t" };
const finding: PlanReviewFinding = { id: "f1", reviewRunId: "r", reviewerRole: "shape-validator", artifactBinding: binding, severity: "blocking", category: "artifact-format", title: "x", description: "x", affectedArtifacts: ["tasks"], affectedSections: [], recommendation: "fix", requiresPlanRevision: true, requiresDesignRevision: false };

test("aggregatePlanReview preserves findings and counts revision flags", () => {
  const aggregate = aggregatePlanReview({ reviewRunId: "r", artifactBinding: binding, findings: [finding], reviewerResults: [{ reviewerRole: "task-coverage-reviewer", status: "succeeded" }] });
  assert.equal(aggregate.findings.length, 1);
  assert.equal(aggregate.counts.blocking, 1);
  assert.equal(aggregate.counts.requiresPlanRevision, 1);
});
