import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { completePlanReviewRun, initializePlanReviewRun, readLatestPlanReviewRun, writePlanReviewerResult } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/review-run-store.ts";
import { createWorkflowLayout } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import type { PlanReviewAggregate, PlanReviewArtifactBinding } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/types.ts";

const ref = { kind: "design" as const, version: 1, path: "d", checksum: "c", createdAt: "t" };
const binding: PlanReviewArtifactBinding = { design: ref, approvedDesignRef: ref, requirements: { ...ref, kind: "requirements" }, tasks: { ...ref, kind: "tasks" }, createdAt: "t" };

test("plan review ledger writes metadata, reviewer results, aggregate, readiness, and reads latest", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-plan-ledger-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  await initializePlanReviewRun(layout, { reviewRunId: "run-1", topic: "my-topic", workflowRunId: "wf", binding });
  await writePlanReviewerResult(layout, "run-1", { reviewRunId: "run-1", reviewerRole: "task-coverage-reviewer", status: "succeeded", findings: [], startedAt: "t", completedAt: "t" });
  const aggregate: PlanReviewAggregate = { reviewRunId: "run-1", artifactBinding: binding, findings: [], reviewerResults: [], counts: { blocking: 0, major: 0, minor: 0, note: 0, requiresPlanRevision: 0, requiresDesignRevision: 0 } };
  await completePlanReviewRun(layout, "run-1", aggregate, { status: "ready-for-plan-approval", blockingFindingIds: [], summary: "ready" });
  assert.ok(await fs.stat(path.join(layout.workflowDir, "reviews", "plan", "run-1", "aggregate.json")));
  const latest = await readLatestPlanReviewRun(layout);
  assert.equal(latest?.reviewRunId, "run-1");
  assert.equal(latest?.readiness?.status, "ready-for-plan-approval");
});
