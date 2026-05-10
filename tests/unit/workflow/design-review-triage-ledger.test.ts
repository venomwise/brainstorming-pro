import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { checksum } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { createDesignReviewRun, ensureReviewLedger, readTriageReport, writeAggregatedFindings, writeDesignReviewRun, writeReadiness, writeReviewerResult, writeTriageReport } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/review-run-store.ts";
import { assertFreshDesignReviewTriage, isDesignReviewTriageStale } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/triage-staleness.ts";
import type { DesignReviewAggregateResult, DesignReviewFinding, DesignReviewerResult, DesignReviewTriageReport } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts";
import type { VersionedArtifactRef } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

async function fixture() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-design-review-triage-ledger-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const ref = await writeVersionedArtifact(layout, "design", "# Design\n");
  const run = createDesignReviewRun({ layout, workflowRunId: "run-1", mode: "minimal", designRef: ref, reviewDecisionRef: "decision-1" });
  await ensureReviewLedger(run, layout);
  await writeDesignReviewRun(layout, run);
  return { cwd, layout, ref, run };
}

function reviewerResult(runId: string): DesignReviewerResult {
  return { reviewRunId: runId, reviewerRole: "minimal-reviewer", status: "succeeded", findings: [], summary: "ok", startedAt: "now", completedAt: "later" };
}

function aggregate(runId: string, ref: VersionedArtifactRef, findings: DesignReviewFinding[] = []): DesignReviewAggregateResult {
  return { reviewRunId: runId, designRef: ref, status: "passed", summary: "passed", counts: { blocking: 0, nonBlocking: 0, notes: 0, byCategory: {}, byReviewer: {} }, findings, readiness: { status: "ready-for-user-approval", blockingFindingIds: [], unresolvedUserQuestions: [], summary: "ready" } };
}

test("writes and reads triage ledger under workflow directory", async () => {
  const { layout, ref, run } = await fixture();
  const result = reviewerResult(run.reviewRunId);
  const updated = await writeReviewerResult(layout, run, result);
  const agg = aggregate(run.reviewRunId, ref);
  const withAggregate = await writeAggregatedFindings(layout, updated, agg);
  const readiness = { status: "ready-for-user-approval" as const, blockingFindingIds: [], unresolvedUserQuestions: [], summary: "ready" };
  await writeReadiness(layout, withAggregate, readiness);
  const report: DesignReviewTriageReport = {
    reviewRunId: run.reviewRunId,
    designRef: ref,
    status: "fresh",
    generatedAt: "2026-01-01T00:00:00.000Z",
    sources: {
      reviewRunId: run.reviewRunId,
      designRef: ref,
      aggregate: { path: path.relative(layout.topicDir, path.join(layout.workflowDir, "reviews", "design", run.reviewRunId, "aggregated-findings.json")), checksum: checksum(JSON.stringify(agg)) },
      reviewerResults: [{ reviewerRole: "minimal-reviewer", path: path.relative(layout.topicDir, path.join(layout.workflowDir, "reviews", "design", run.reviewRunId, "reviewer-results", "minimal-reviewer.json")), checksum: checksum(JSON.stringify(result)), status: "succeeded" }],
    },
    findings: [],
    clusters: [],
    conflicts: [],
    unresolvedQuestions: [],
    coverage: { availableReviewers: [], selectedReviewers: [], unselectedReviewers: [], succeededReviewers: [], failedReviewers: [], pendingRetryReviewers: [], status: "unavailable", hasIncompleteCoverage: false },
    readiness: { status: "ready-for-user-approval", sourceReadiness: readiness, recommendedNextAction: "approve-design", blockingFindingIds: [], blockingConflictIds: [], blockingQuestionIds: [], summary: "ready" },
    summary: "ready",
  };
  await writeTriageReport(layout, run, report);
  const readBack = await readTriageReport(layout, run);
  assert.equal(readBack.reviewRunId, run.reviewRunId);
  assert.equal(readBack.sources.aggregate.checksum, report.sources.aggregate.checksum);
});

test("triage write fails closed when path escapes workflow directory", async () => {
  const { layout, ref, run } = await fixture();
  await assert.rejects(() => writeTriageReport(layout, run, { reviewRunId: run.reviewRunId, designRef: ref, status: "fresh", generatedAt: "2026-01-01T00:00:00.000Z", sources: { reviewRunId: run.reviewRunId, designRef: ref, aggregate: { path: "../escape.json", checksum: "x" }, reviewerResults: [] }, findings: [], clusters: [], conflicts: [], unresolvedQuestions: [], coverage: { availableReviewers: [], selectedReviewers: [], unselectedReviewers: [], succeededReviewers: [], failedReviewers: [], pendingRetryReviewers: [], status: "unavailable", hasIncompleteCoverage: false }, readiness: { status: "ready-for-user-approval", sourceReadiness: { status: "ready-for-user-approval", blockingFindingIds: [], unresolvedUserQuestions: [], summary: "ready" }, recommendedNextAction: "approve-design", blockingFindingIds: [], blockingConflictIds: [], blockingQuestionIds: [], summary: "ready" }, summary: "ready" } as DesignReviewTriageReport), /Unsafe workflow path outside topic directory/u);
});

test("stale triage is detected when design checksum changes", async () => {
  const { layout, ref, run } = await fixture();
  const result = reviewerResult(run.reviewRunId);
  const updated = await writeReviewerResult(layout, run, result);
  const agg = aggregate(run.reviewRunId, ref);
  const withAggregate = await writeAggregatedFindings(layout, updated, agg);
  await writeReadiness(layout, withAggregate, { status: "ready-for-user-approval", blockingFindingIds: [], unresolvedUserQuestions: [], summary: "ready" });
  const report: DesignReviewTriageReport = {
    reviewRunId: run.reviewRunId,
    designRef: ref,
    status: "fresh",
    generatedAt: "2026-01-01T00:00:00.000Z",
    sources: {
      reviewRunId: run.reviewRunId,
      designRef: ref,
      aggregate: { path: path.relative(layout.topicDir, path.join(layout.workflowDir, "reviews", "design", run.reviewRunId, "aggregated-findings.json")), checksum: checksum(JSON.stringify(agg)) },
      reviewerResults: [{ reviewerRole: "minimal-reviewer", path: path.relative(layout.topicDir, path.join(layout.workflowDir, "reviews", "design", run.reviewRunId, "reviewer-results", "minimal-reviewer.json")), checksum: checksum(JSON.stringify(result)), status: "succeeded" }],
    },
    findings: [],
    clusters: [],
    conflicts: [],
    unresolvedQuestions: [],
    coverage: { availableReviewers: [], selectedReviewers: [], unselectedReviewers: [], succeededReviewers: [], failedReviewers: [], pendingRetryReviewers: [], status: "unavailable", hasIncompleteCoverage: false },
    readiness: { status: "ready-for-user-approval", sourceReadiness: { status: "ready-for-user-approval", blockingFindingIds: [], unresolvedUserQuestions: [], summary: "ready" }, recommendedNextAction: "approve-design", blockingFindingIds: [], blockingConflictIds: [], blockingQuestionIds: [], summary: "ready" },
    summary: "ready",
  };
  await writeTriageReport(layout, run, report);
  await writeVersionedArtifact(layout, "design", "# Design\nupdated");
  assert.equal(await isDesignReviewTriageStale(layout, run, report), true);
  await assert.rejects(() => assertFreshDesignReviewTriage(layout, run), /stale/u);
});

test("corrupted triage report is rejected on read", async () => {
  const { layout, run } = await fixture();
  const triagePath = path.join(layout.topicDir, run.ledgerPath, "triage-report.json");
  await fs.writeFile(triagePath, "not-json");
  await assert.rejects(() => readTriageReport(layout, run), /missing, corrupted, or inconsistent/u);
});
