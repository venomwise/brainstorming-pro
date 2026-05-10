import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { aggregatePartialDesignReviewFindings } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/partial-aggregation.ts";
import { computeDesignReviewCoverage } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/review-coverage.ts";
import { createDesignReviewRun, ensureReviewLedger, readCoverage, validateReviewLedgerConsistency, writeAcceptIncompleteDecision, writeAggregatedFindings, writeCoverage, writeDesignReviewRun, writeReadiness, writeReviewerResult } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/review-run-store.ts";
import { completeDesignReviewAttempt, createDesignReviewAttempt, writeAttemptReviewerResult } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/review-attempt-store.ts";
import type { AcceptIncompleteDesignReviewDecision, DesignReviewerResult } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts";

async function fixture() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-design-review-exec-ledger-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const ref = await writeVersionedArtifact(layout, "design", "# Design");
  const run = createDesignReviewRun({ layout, workflowRunId: "run-1", mode: "full", designRef: ref, reviewDecisionRef: "decision-1" });
  await ensureReviewLedger(run, layout);
  await writeDesignReviewRun(layout, run);
  return { layout, ref, run };
}

function reviewer(reviewerRole: DesignReviewerResult["reviewerRole"], status: DesignReviewerResult["status"]): DesignReviewerResult {
  return {
    reviewRunId: "run-1",
    reviewerRole,
    status,
    findings: [],
    error: status === "failed" ? { kind: "timeout", message: "timed out", retryable: true } : undefined,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
  };
}

test("writes attempt-aware ledger layout, coverage, aggregate, readiness, and accept-incomplete decision", async () => {
  const { layout, ref, run } = await fixture();
  const product = { ...reviewer("product-reviewer", "succeeded"), reviewRunId: run.reviewRunId };
  const testing = { ...reviewer("testing-reviewer", "failed"), reviewRunId: run.reviewRunId };
  const attempt = await createDesignReviewAttempt({ layout, reviewRun: run, designRef: ref, reviewerRoles: ["product-reviewer", "testing-reviewer"], reason: "initial" });
  await writeAttemptReviewerResult(layout, run, attempt, product);
  await writeAttemptReviewerResult(layout, run, attempt, testing);
  await completeDesignReviewAttempt(layout, run, attempt, { succeededReviewers: ["product-reviewer"], failedReviewers: ["testing-reviewer"] });
  const runWithProduct = await writeReviewerResult(layout, run, product);
  const runWithTesting = await writeReviewerResult(layout, runWithProduct, testing);
  const coverage = computeDesignReviewCoverage({ selectedReviewerRoles: ["product-reviewer", "testing-reviewer"], reviewerResults: [product, testing] });
  await writeCoverage(layout, runWithTesting, coverage);
  const aggregate = aggregatePartialDesignReviewFindings({ reviewRunId: run.reviewRunId, designRef: ref, successfulResults: [product], failedResults: [testing], coverage });
  const runWithAggregate = await writeAggregatedFindings(layout, runWithTesting, aggregate);
  const runWithReadiness = await writeReadiness(layout, runWithAggregate, aggregate.readiness);
  await writeDesignReviewRun(layout, runWithReadiness);
  const accept: AcceptIncompleteDesignReviewDecision = {
    decisionId: "accept-1",
    reviewRunId: run.reviewRunId,
    designRef: ref,
    acceptedCoverage: coverage,
    successfulResultRefs: [path.join(run.ledgerPath, "reviewer-results", "product-reviewer.json")],
    failedDiagnosticRefs: [path.join(run.ledgerPath, "reviewer-results", "testing-reviewer.json")],
    aggregateRef: path.join(run.ledgerPath, "aggregated-findings.json"),
    decidedBy: "user",
    decidedAt: "2026-01-01T00:00:02.000Z",
  };
  await writeAcceptIncompleteDecision(layout, runWithReadiness, accept);

  const root = path.join(layout.topicDir, run.ledgerPath);
  assert.equal((await fs.stat(path.join(root, "attempts", "attempt-001", "attempt.json"))).isFile(), true);
  assert.equal((await fs.stat(path.join(root, "attempts", "attempt-001", "reviewer-results", "product-reviewer.json"))).isFile(), true);
  assert.equal((await fs.stat(path.join(root, "reviewer-results", "testing-reviewer.json"))).isFile(), true);
  assert.equal((await fs.stat(path.join(root, "coverage.json"))).isFile(), true);
  assert.equal((await fs.stat(path.join(root, "accept-incomplete-decision.json"))).isFile(), true);
  assert.deepEqual((await readCoverage(layout, runWithReadiness)).pendingRetryReviewers, ["testing-reviewer"]);
  await validateReviewLedgerConsistency(layout, runWithReadiness);
});

test("rejects corrupted ledger consistency before recovery", async () => {
  const { layout, ref, run } = await fixture();
  const coverage = computeDesignReviewCoverage({ selectedReviewerRoles: ["product-reviewer"], reviewerResults: [reviewer("product-reviewer", "succeeded")] });
  await writeCoverage(layout, run, coverage);
  const aggregate = aggregatePartialDesignReviewFindings({ reviewRunId: run.reviewRunId, designRef: ref, successfulResults: [{ ...reviewer("product-reviewer", "succeeded"), reviewRunId: run.reviewRunId }], failedResults: [{ ...reviewer("testing-reviewer", "failed"), reviewRunId: run.reviewRunId }], coverage });
  await writeAggregatedFindings(layout, run, { ...aggregate, coverage: { ...coverage, failedReviewers: ["testing-reviewer"] } });
  await writeReadiness(layout, run, aggregate.readiness);
  await assert.rejects(() => validateReviewLedgerConsistency(layout, run), /coverage does not match/);
});
