import { createWorkflowLayout } from "../../artifact-store.ts";
import { appendWorkflowEvent } from "../../events.ts";
import type { WorkflowState } from "../../types.ts";
import { bindDesignArtifactForReview } from "./artifact-binding.ts";
import { resolveDesignReviewMode } from "./mode.ts";
import { aggregateDesignReviewFindings } from "./aggregation.ts";
import { aggregatePartialDesignReviewFindings } from "./partial-aggregation.ts";
import { evaluateDesignApprovalReadiness } from "./readiness.ts";
import { computeDesignReviewCoverage } from "./review-coverage.ts";
import { createDesignReviewRun, ensureReviewLedger, writeAggregatedFindings, writeCoverage, writeDesignReviewRun, writeReadiness, writeReviewerResult } from "./review-run-store.ts";
import { completeDesignReviewAttempt, createDesignReviewAttempt, writeAttemptReviewerResult } from "./review-attempt-store.ts";
import { runDesignReviewers, type FullDesignReviewerRole, type ReviewerCoordinatorOptions } from "./reviewer-coordinator.ts";
import { resolveDesignReviewerSelection, type ResolvedDesignReviewerSelection } from "./reviewer-selection.ts";
import type { DesignReviewPanelResult, DesignReviewRun } from "./types.ts";

export async function runDesignReviewPanel(state: WorkflowState, options: ReviewerCoordinatorOptions): Promise<DesignReviewPanelResult> {
  const decision = state.reviewDecisions.design;
  if (!decision) throw new Error("Design review decision is missing.");
  const layout = await createWorkflowLayout(options.projectRoot, state.topic);
  const mode = resolveDesignReviewMode(decision);
  const artifact = await bindDesignArtifactForReview(layout, state, decision);
  const reviewerSelection: ResolvedDesignReviewerSelection | undefined = mode === "full" ? resolveDesignReviewerSelection(decision, artifact.ref) : undefined;
  if (reviewerSelection) {
    await appendWorkflowEvent(layout, {
      type: "design-review-reviewer-selection-recorded",
      phase: "design-review",
      details: {
        decisionId: decision.id,
        designRef: artifact.ref,
        selectedReviewerRoles: reviewerSelection.selectedReviewerRoles,
        unselectedReviewerRoles: reviewerSelection.unselectedReviewerRoles,
        recordedAt: new Date().toISOString(),
      },
    });
  }
  let run: DesignReviewRun = createDesignReviewRun({
    layout,
    workflowRunId: state.runId,
    mode,
    designRef: artifact.ref,
    reviewDecisionRef: decision.id,
  });
  await ensureReviewLedger(run, layout);
  await writeDesignReviewRun(layout, run);

  if (mode === "skip") {
    const readiness = evaluateDesignApprovalReadiness({ status: "skipped" });
    run = { ...run, status: "skipped", skipReason: "user-selected-skip", readiness, completedAt: new Date().toISOString() };
    await writeReadiness(layout, run, readiness);
    await writeDesignReviewRun(layout, run);
    return { reviewRunId: run.reviewRunId, mode, status: "skipped", designRef: artifact.ref, readiness, ledgerPath: run.ledgerPath, reason: "user-selected-skip" };
  }

  run = { ...run, status: "running" };
  await writeDesignReviewRun(layout, run);
  const attempt = reviewerSelection ? await createDesignReviewAttempt({ layout, reviewRun: run, designRef: artifact.ref, reviewerRoles: reviewerSelection.selectedReviewerRoles, reason: "initial" }) : undefined;
  if (attempt) {
    await appendWorkflowEvent(layout, {
      type: "design-review-attempt-started",
      phase: "design-review",
      details: { reviewRunId: run.reviewRunId, attemptId: attempt.attemptId, reviewerRoles: attempt.reviewerRoles, startedAt: attempt.startedAt },
    });
  }
  let reviewerResults;
  try {
    reviewerResults = await runDesignReviewers({ mode, reviewRunId: run.reviewRunId, artifact, state, options, selectedFullReviewerRoles: reviewerSelection?.selectedReviewerRoles });
  } catch (error) {
    const reviewError = { kind: "reviewer-coordinator-error", message: error instanceof Error ? error.message : String(error), retryable: false };
    const readiness = evaluateDesignApprovalReadiness({ status: "failed" });
    const aggregate = aggregateDesignReviewFindings({ reviewRunId: run.reviewRunId, designRef: artifact.ref, findings: [], forcedStatus: "failed" });
    run = await writeAggregatedFindings(layout, run, aggregate);
    run = await writeReadiness(layout, run, readiness);
    run = { ...run, status: "failed", error: reviewError, completedAt: new Date().toISOString() };
    await writeDesignReviewRun(layout, run);
    return { reviewRunId: run.reviewRunId, mode, status: "failed", designRef: artifact.ref, aggregate, readiness, ledgerPath: run.ledgerPath, error: reviewError };
  }
  for (const result of reviewerResults) {
    if (attempt) await writeAttemptReviewerResult(layout, run, attempt, result);
    run = await writeReviewerResult(layout, run, result);
  }
  const failedResults = reviewerResults.filter((result) => result.status === "failed");
  const successfulResults = reviewerResults.filter((result) => result.status === "succeeded");
  if (attempt) {
    const completedAttempt = await completeDesignReviewAttempt(layout, run, attempt, {
      succeededReviewers: successfulResults.map((result) => result.reviewerRole as FullDesignReviewerRole),
      failedReviewers: failedResults.map((result) => result.reviewerRole as FullDesignReviewerRole),
    });
    await appendWorkflowEvent(layout, {
      type: "design-review-attempt-completed",
      phase: "design-review",
      details: {
        reviewRunId: run.reviewRunId,
        attemptId: completedAttempt.attemptId,
        reviewerRoles: completedAttempt.reviewerRoles,
        succeededReviewerRoles: completedAttempt.succeededReviewers,
        failedReviewerRoles: completedAttempt.failedReviewers,
        completedAt: completedAttempt.completedAt,
      },
    });
  }
  if (failedResults.length > 0 && mode === "full" && successfulResults.length > 0 && reviewerSelection) {
    const coverage = computeDesignReviewCoverage({ selectedReviewerRoles: reviewerSelection.selectedReviewerRoles, reviewerResults });
    await writeCoverage(layout, run, coverage);
    const aggregate = aggregatePartialDesignReviewFindings({ reviewRunId: run.reviewRunId, designRef: artifact.ref, successfulResults, failedResults, coverage });
    run = await writeAggregatedFindings(layout, run, aggregate);
    run = await writeReadiness(layout, run, aggregate.readiness);
    await appendWorkflowEvent(layout, {
      type: "design-review-partial-aggregated",
      phase: "design-review",
      details: { reviewRunId: run.reviewRunId, coverage, readinessStatus: aggregate.readiness.status, aggregatedAt: new Date().toISOString() },
    });
    run = { ...run, status: aggregate.status, error: failedResults[0]?.error, completedAt: new Date().toISOString() };
    await writeDesignReviewRun(layout, run);
    return { reviewRunId: run.reviewRunId, mode, status: aggregate.status, designRef: artifact.ref, aggregate, readiness: aggregate.readiness, ledgerPath: run.ledgerPath, error: failedResults[0]?.error };
  }
  const failed = failedResults[0];
  if (failed) {
    const coverage = mode === "full" && reviewerSelection ? computeDesignReviewCoverage({ selectedReviewerRoles: reviewerSelection.selectedReviewerRoles, reviewerResults }) : undefined;
    if (coverage) await writeCoverage(layout, run, coverage);
    const readiness = evaluateDesignApprovalReadiness({ status: "failed", coverage });
    const aggregate = aggregateDesignReviewFindings({ reviewRunId: run.reviewRunId, designRef: artifact.ref, findings: [], forcedStatus: "failed", coverage });
    run = await writeAggregatedFindings(layout, run, aggregate);
    run = await writeReadiness(layout, run, readiness);
    run = { ...run, status: "failed", error: failed.error, completedAt: new Date().toISOString() };
    await writeDesignReviewRun(layout, run);
    return { reviewRunId: run.reviewRunId, mode, status: "failed", designRef: artifact.ref, aggregate, readiness, ledgerPath: run.ledgerPath, error: failed.error };
  }
  const findings = reviewerResults.flatMap((result) => result.findings);
  const coverage = mode === "full" && reviewerSelection ? computeDesignReviewCoverage({ selectedReviewerRoles: reviewerSelection.selectedReviewerRoles, reviewerResults }) : undefined;
  if (coverage) await writeCoverage(layout, run, coverage);
  const aggregate = aggregateDesignReviewFindings({ reviewRunId: run.reviewRunId, designRef: artifact.ref, findings, coverage });
  run = await writeAggregatedFindings(layout, run, aggregate);
  run = await writeReadiness(layout, run, aggregate.readiness);
  run = { ...run, status: aggregate.status, completedAt: new Date().toISOString() };
  await writeDesignReviewRun(layout, run);
  return { reviewRunId: run.reviewRunId, mode, status: aggregate.status, designRef: artifact.ref, aggregate, readiness: aggregate.readiness, ledgerPath: run.ledgerPath };
}
