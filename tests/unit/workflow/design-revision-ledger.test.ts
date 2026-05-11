import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { checksum, createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { getDesignRevisionLedgerPaths, readDesignRevisionAuthorization, readDesignRevisionRecord, writeDesignRevisionAuthorization, writeDesignRevisionRecord } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-revision/ledger.ts";
import { bindDesignRevisionSources } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-revision/source-binding.ts";
import type { DesignRevisionAuthorization, DesignRevisionRecord } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-revision/types.ts";
import { createDesignReviewRun, ensureReviewLedger, writeAggregatedFindings, writeCoverage, writeDesignReviewRun, writeReadiness, writeTriageReport } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/review-run-store.ts";
import type { DesignReviewAggregateResult, DesignReviewCoverage, DesignReviewTriageReport } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts";
import type { WorkflowLayout } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";

async function tempLayout(): Promise<WorkflowLayout> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-revision-ledger-"));
  return await createWorkflowLayout(root, "demo-topic");
}

test("rejects revision id path traversal", async () => {
  const layout = await tempLayout();
  assert.throws(() => getDesignRevisionLedgerPaths(layout.topicDir, "../escape"), /Unsafe design revision id/);
});

test("writes and reads safe revision ledger files", async () => {
  const layout = await tempLayout();
  const designRef = await writeVersionedArtifact(layout, "design", "# Design\n\n## Summary\nDemo");
  const authorization = makeAuthorization(designRef);
  await writeDesignRevisionAuthorization(layout, authorization);
  assert.equal((await readDesignRevisionAuthorization(layout, authorization.revisionId)).revisionId, authorization.revisionId);

  const record: DesignRevisionRecord = {
    revisionId: authorization.revisionId,
    workflowRunId: authorization.workflowRunId,
    topic: authorization.topic,
    status: "failed",
    sourceDesignRef: designRef,
    sourceReviewRunId: authorization.sourceReviewRunId,
    sourceTriageRef: authorization.sourceTriageRef,
    sourceReadinessRef: authorization.sourceReadinessRef,
    resolvedItemIds: [],
    unresolvedItemIds: [],
    changeSummary: [],
    reason: "adapter failed",
    completedAt: "2026-05-11T00:10:00.000Z",
  };
  await writeDesignRevisionRecord(layout, record);
  assert.equal((await readDesignRevisionRecord(layout, authorization.revisionId)).status, "failed");
});

test("fails closed on source checksum mismatch", async () => {
  const layout = await tempLayout();
  const designRef = await writeVersionedArtifact(layout, "design", "# Design\n\n## Summary\nDemo");
  const run = createDesignReviewRun({ layout, workflowRunId: "run-1", mode: "full", designRef, reviewDecisionRef: "decision-1" });
  await ensureReviewLedger(run, layout);
  await writeDesignReviewRun(layout, run);

  const coverage: DesignReviewCoverage = { availableReviewers: [], selectedReviewers: [], unselectedReviewers: [], succeededReviewers: [], failedReviewers: [], pendingRetryReviewers: [] };
  await writeCoverage(layout, run, coverage);
  const aggregate: DesignReviewAggregateResult = {
    reviewRunId: run.reviewRunId,
    designRef,
    status: "blocked",
    summary: "Blocked",
    counts: { blocking: 1, nonBlocking: 0, notes: 0, byCategory: {}, byReviewer: {} },
    findings: [],
    readiness: { status: "blocked", blockingFindingIds: [], unresolvedUserQuestions: [], summary: "Blocked" },
    coverage,
  };
  await writeAggregatedFindings(layout, run, aggregate);
  await writeReadiness(layout, run, aggregate.readiness);
  const triage: DesignReviewTriageReport = {
    reviewRunId: run.reviewRunId,
    designRef,
    status: "fresh",
    generatedAt: "2026-05-11T00:00:00.000Z",
    sources: { reviewRunId: run.reviewRunId, designRef, aggregate: { path: path.join(run.ledgerPath, "aggregated-findings.json"), checksum: checksum(`${JSON.stringify(aggregate, null, 2)}\n`) }, coverage: { path: path.join(run.ledgerPath, "coverage.json"), checksum: checksum(`${JSON.stringify(coverage, null, 2)}\n`) }, reviewerResults: [], reviewDecisionRef: "decision-1" },
    findings: [],
    clusters: [],
    conflicts: [],
    unresolvedQuestions: [],
    coverage: { ...coverage, status: "complete", hasIncompleteCoverage: false },
    readiness: { status: "blocked", sourceReadiness: aggregate.readiness, recommendedNextAction: "revise-design", blockingFindingIds: [], blockingConflictIds: [], blockingQuestionIds: [], summary: "Blocked" },
    summary: "Blocked",
  };
  const writtenTriage = await writeTriageReport(layout, run, triage);
  const authorization = makeAuthorization(designRef, {
    sourceReviewRunId: run.reviewRunId,
    sourceTriageRef: { path: path.join(run.ledgerPath, "triage-report.json"), checksum: checksum(`${JSON.stringify(writtenTriage, null, 2)}\n`) },
    sourceReadinessRef: { path: path.join(run.ledgerPath, "readiness.json"), checksum: "bad-checksum" },
    sourceCoverageRef: { path: path.join(run.ledgerPath, "coverage.json"), checksum: checksum(`${JSON.stringify(coverage, null, 2)}\n`) },
  });

  await assert.rejects(() => bindDesignRevisionSources(layout, authorization, run), /readiness checksum mismatch/);
});

test("corrupted ledger resume/status fails closed", async () => {
  const layout = await tempLayout();
  const designRef = await writeVersionedArtifact(layout, "design", "# Design");
  const authorization = makeAuthorization(designRef);
  await writeDesignRevisionAuthorization(layout, authorization);
  const paths = getDesignRevisionLedgerPaths(layout.topicDir, authorization.revisionId);
  await fs.writeFile(paths.authorization, "{not-json");
  await assert.rejects(() => readDesignRevisionAuthorization(layout, authorization.revisionId), /Revision ledger is missing, corrupted, or inconsistent/);
});

function makeAuthorization(sourceDesignRef: DesignRevisionAuthorization["sourceDesignRef"], overrides: Partial<DesignRevisionAuthorization> = {}): DesignRevisionAuthorization {
  return {
    revisionId: "rev-1",
    workflowRunId: "run-1",
    topic: "demo-topic",
    allowedAction: "single-revision-and-rereview",
    sourceDesignRef,
    sourceReviewRunId: "review-1",
    sourceTriageRef: { path: ".workflow/reviews/design/review-1/triage-report.json", checksum: "sha256-triage" },
    sourceReadinessRef: { path: ".workflow/reviews/design/review-1/readiness.json", checksum: "sha256-readiness" },
    postRevisionReview: { mode: "full", selectedReviewerRoles: ["product-reviewer"] },
    roundPolicy: { maxTotalRevisionRounds: 3, maxTotalPostRevisionReviewRounds: 3, usedRevisionRounds: 0, usedPostRevisionReviewRounds: 0 },
    userAnswers: [],
    authorizedBy: "user",
    authorizedAt: "2026-05-11T00:00:00.000Z",
    ...overrides,
  };
}
