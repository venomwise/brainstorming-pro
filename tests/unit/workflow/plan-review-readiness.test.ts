import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePlanApprovalReadiness } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/readiness.ts";
import type { PlanReviewAggregate, PlanReviewArtifactBinding, PlanReviewFinding } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/types.ts";

const ref = { kind: "design" as const, version: 1, path: "d", checksum: "c", createdAt: "t" };
const binding: PlanReviewArtifactBinding = { design: ref, approvedDesignRef: ref, requirements: { ...ref, kind: "requirements" }, tasks: { ...ref, kind: "tasks" }, createdAt: "t" };
function aggregate(findings: PlanReviewFinding[], failed = false): PlanReviewAggregate { return { reviewRunId: "r", artifactBinding: binding, findings, reviewerResults: [{ reviewerRole: "task-coverage-reviewer", status: failed ? "failed" : "succeeded" }], counts: { blocking: 0, major: 0, minor: 0, note: 0, requiresPlanRevision: 0, requiresDesignRevision: 0 } }; }
function finding(patch: Partial<PlanReviewFinding>): PlanReviewFinding { return { id: "f", reviewRunId: "r", reviewerRole: "shape-validator", artifactBinding: binding, severity: "blocking", category: "artifact-format", title: "x", description: "x", affectedArtifacts: ["tasks"], affectedSections: [], recommendation: "fix", requiresPlanRevision: true, requiresDesignRevision: false, ...patch }; }

test("readiness covers ready, plan blocker, design blocker, failed, and stale", () => {
  assert.equal(evaluatePlanApprovalReadiness({ aggregate: aggregate([]) }).status, "ready-for-plan-approval");
  assert.equal(evaluatePlanApprovalReadiness({ aggregate: aggregate([finding({})]) }).status, "blocked-needs-plan-revision");
  assert.equal(evaluatePlanApprovalReadiness({ aggregate: aggregate([finding({ requiresDesignRevision: true, requiresPlanRevision: false })]) }).status, "blocked-needs-design-revision");
  assert.equal(evaluatePlanApprovalReadiness({ aggregate: aggregate([], true) }).status, "failed");
  assert.equal(evaluatePlanApprovalReadiness({ aggregate: aggregate([]), stale: true }).status, "stale");
});
