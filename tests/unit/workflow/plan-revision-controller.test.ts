import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { commitPlanRevisionArtifacts, createPlanRevisionPolicy } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/revision-controller.ts";
import { createWorkflowLayout } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import type { PlanReviewAggregate, PlanReviewArtifactBinding, PlanReviewFinding } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/types.ts";

const ref = { kind: "design" as const, version: 1, path: "d", checksum: "c", createdAt: "t" };
const binding: PlanReviewArtifactBinding = { design: ref, approvedDesignRef: ref, requirements: { ...ref, kind: "requirements" }, tasks: { ...ref, kind: "tasks" }, createdAt: "t" };
function finding(patch = {}): PlanReviewFinding { return { id: "f", reviewRunId: "r", reviewerRole: "shape-validator", artifactBinding: binding, severity: "blocking", category: "artifact-format", title: "x", description: "x", affectedArtifacts: ["tasks"], affectedSections: [], recommendation: "fix", requiresPlanRevision: true, requiresDesignRevision: false, ...patch }; }
function aggregate(findings: PlanReviewFinding[]): PlanReviewAggregate { return { reviewRunId: "r", artifactBinding: binding, findings, reviewerResults: [], counts: { blocking: 1, major: 0, minor: 0, note: 0, requiresPlanRevision: 1, requiresDesignRevision: 0 } }; }

test("plan revision policy is eligible once and blocks design revision or repeat attempts", () => {
  assert.equal(createPlanRevisionPolicy({ revisionId: "rev", aggregate: aggregate([finding()]), readiness: { status: "blocked-needs-plan-revision", blockingFindingIds: ["f"], summary: "x" }, alreadyUsed: false }).eligible, true);
  assert.equal(createPlanRevisionPolicy({ revisionId: "rev", aggregate: aggregate([finding()]), readiness: { status: "blocked-needs-plan-revision", blockingFindingIds: ["f"], summary: "x" }, alreadyUsed: true }).eligible, false);
  assert.equal(createPlanRevisionPolicy({ revisionId: "rev", aggregate: aggregate([finding({ requiresDesignRevision: true, requiresPlanRevision: false })]), readiness: { status: "blocked-needs-plan-revision", blockingFindingIds: ["f"], summary: "x" }, alreadyUsed: false }).eligible, false);
});

test("commitPlanRevisionArtifacts validates output and commits new requirements/tasks versions", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-plan-revision-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const committed = await commitPlanRevisionArtifacts(layout, { status: "revised", revisedRequirements: "# Requirements v2", revisedTasks: "# Tasks\n\n## Tasks\n\n- [ ] 1. Phase\n  - _Requirements: 1.1_", addressedFindingIds: ["f"], unresolvedFindingIds: [], summary: "x", requiresDesignRevision: false });
  assert.equal(committed.requirementsRef.kind, "requirements");
  assert.equal(committed.tasksRef.kind, "tasks");
  await assert.rejects(() => commitPlanRevisionArtifacts(layout, { status: "revised", revisedRequirements: "x", revisedTasks: "- [✅] 1. Done", addressedFindingIds: [], unresolvedFindingIds: [], summary: "x", requiresDesignRevision: false }), /must not mark task execution/u);
});
