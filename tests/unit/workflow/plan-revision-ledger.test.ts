import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writePlanRevisionLedger } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/revision-ledger.ts";
import { createWorkflowLayout } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import type { PlanReviewAggregate, PlanReviewArtifactBinding } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/types.ts";

const ref = { kind: "design" as const, version: 1, path: "d", checksum: "c", createdAt: "t" };
const binding: PlanReviewArtifactBinding = { design: ref, approvedDesignRef: ref, requirements: { ...ref, kind: "requirements" }, tasks: { ...ref, kind: "tasks" }, createdAt: "t" };

test("plan revision ledger writes source, output, committed artifacts, and post-review link", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-plan-rev-ledger-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const aggregate: PlanReviewAggregate = { reviewRunId: "review-1", artifactBinding: binding, findings: [], reviewerResults: [], counts: { blocking: 0, major: 0, minor: 0, note: 0, requiresPlanRevision: 0, requiresDesignRevision: 0 } };
  const ledger = await writePlanRevisionLedger(layout, { revisionId: "rev-1", policy: { revisionId: "rev-1", sourceReviewRunId: "review-1", usedForPlanCycle: false, eligible: true }, sourceReviewRunId: "review-1", aggregate, reviserOutput: { status: "revised", revisedRequirements: "r", revisedTasks: "t", addressedFindingIds: [], unresolvedFindingIds: [], summary: "x", requiresDesignRevision: false }, committedArtifacts: { requirementsRef: binding.requirements, tasksRef: binding.tasks }, postRevisionReviewRunId: "review-2" });
  assert.equal(ledger, ".workflow/revisions/plan/rev-1");
  assert.ok(await fs.stat(path.join(layout.workflowDir, "revisions", "plan", "rev-1", "post-revision-review.json")));
});
