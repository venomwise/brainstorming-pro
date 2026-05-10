import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowLayout, writeVersionedArtifact } from "../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { createDesignReviewRun, ensureReviewLedger, writeTriageReport } from "../../extensions/clarification-orchestrator/workflow/adapters/design-review/review-run-store.ts";
import { validateDesignReviewTriageReport } from "../../extensions/clarification-orchestrator/workflow/adapters/design-review/triage-schemas.ts";
import type { DesignReviewTriageReport } from "../../extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts";

async function fixture() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-triage-security-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const ref = await writeVersionedArtifact(layout, "design", "# Design\n");
  const run = createDesignReviewRun({ layout, workflowRunId: "run-1", mode: "minimal", designRef: ref, reviewDecisionRef: "decision-1" });
  await ensureReviewLedger(run, layout);
  return { layout, ref, run };
}

test("crafted triage cannot claim workflow authority", () => {
  const designRef = { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "abc", createdAt: "2026-01-01T00:00:00.000Z" };
  assert.throws(() => validateDesignReviewTriageReport({ approval: true }), /unauthorized directive|must be/u);
  assert.throws(() => validateDesignReviewTriageReport({ reviewRunId: "run", designRef, status: "fresh", generatedAt: "now", sources: { reviewRunId: "run", designRef, aggregate: { path: ".workflow/reviews/design/run/aggregated-findings.json", checksum: "x" }, reviewerResults: [] }, findings: [], clusters: [], conflicts: [], unresolvedQuestions: [], coverage: { availableReviewers: [], selectedReviewers: [], unselectedReviewers: [], succeededReviewers: [], failedReviewers: [], pendingRetryReviewers: [], status: "unavailable", hasIncompleteCoverage: false }, readiness: { approveDesign: true }, summary: "x" }), /unauthorized directive/u);
});

test("path traversal in triage source refs fails closed", async () => {
  const { layout, ref, run } = await fixture();
  const report = { reviewRunId: run.reviewRunId, designRef: ref, status: "fresh", generatedAt: "2026-01-01T00:00:00.000Z", sources: { reviewRunId: run.reviewRunId, designRef: ref, aggregate: { path: "../../escape.json", checksum: "x" }, reviewerResults: [] }, findings: [], clusters: [], conflicts: [], unresolvedQuestions: [], coverage: { availableReviewers: [], selectedReviewers: [], unselectedReviewers: [], succeededReviewers: [], failedReviewers: [], pendingRetryReviewers: [], status: "unavailable", hasIncompleteCoverage: false }, readiness: { status: "ready-for-user-approval", sourceReadiness: { status: "ready-for-user-approval", blockingFindingIds: [], unresolvedUserQuestions: [], summary: "ready" }, recommendedNextAction: "approve-design", blockingFindingIds: [], blockingConflictIds: [], blockingQuestionIds: [], summary: "ready" }, summary: "ready" } as DesignReviewTriageReport;
  await assert.rejects(() => writeTriageReport(layout, run, report), /Unsafe workflow path/u);
});
