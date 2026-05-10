import { appendWorkflowEvent } from "../../events.ts";
import type { WorkflowLayout } from "../../artifact-store.ts";
import type { WorkflowState } from "../../types.ts";
import { bindDesignArtifactForReview } from "./artifact-binding.ts";
import { aggregateDesignReviewFindings } from "./aggregation.ts";
import { aggregatePartialDesignReviewFindings } from "./partial-aggregation.ts";
import { computeDesignReviewCoverage } from "./review-coverage.ts";
import { completeDesignReviewAttempt, createDesignReviewAttempt, writeAttemptReviewerResult } from "./review-attempt-store.ts";
import { readCoverage, readReviewerResults, validateReviewLedgerConsistency, writeAggregatedFindings, writeCoverage, writeDesignReviewRun, writeReadiness, writeReviewerResult } from "./review-run-store.ts";
import { runDesignReviewers, type FullDesignReviewerRole, type ReviewerCoordinatorOptions } from "./reviewer-coordinator.ts";
import type { DesignReviewPanelResult, DesignReviewRun, DesignReviewerResult } from "./types.ts";

export async function retryFailedDesignReviewers(input: {
  layout: WorkflowLayout;
  state: WorkflowState;
  reviewRun: DesignReviewRun;
  options: ReviewerCoordinatorOptions;
  reviewerRoles?: readonly FullDesignReviewerRole[];
}): Promise<DesignReviewPanelResult> {
  if (input.reviewRun.mode !== "full") throw new Error("Only full design review failed reviewers can be retried.");
  const decision = input.state.reviewDecisions.design;
  if (!decision) throw new Error("Design review decision is missing.");
  const artifact = await bindDesignArtifactForReview(input.layout, input.state, decision);
  if (artifact.ref.checksum !== input.reviewRun.designRef.checksum || artifact.ref.version !== input.reviewRun.designRef.version || artifact.ref.path !== input.reviewRun.designRef.path) {
    throw new Error("Cannot retry failed reviewers for a stale design artifact.");
  }
  await validateReviewLedgerConsistency(input.layout, input.reviewRun);
  const previousCoverage = await readCoverage(input.layout, input.reviewRun);
  const retryRoles = [...(input.reviewerRoles ?? previousCoverage.failedReviewers)];
  if (retryRoles.length === 0) throw new Error("No failed design reviewers are available to retry.");
  const selected = new Set(previousCoverage.selectedReviewers);
  for (const role of retryRoles) {
    if (!selected.has(role)) throw new Error(`Cannot retry reviewer outside stable selected set: ${role}`);
  }
  const previousResults = await readReviewerResults(input.layout, input.reviewRun);
  const attempt = await createDesignReviewAttempt({ layout: input.layout, reviewRun: input.reviewRun, designRef: artifact.ref, reviewerRoles: retryRoles, reason: "retry-failed-reviewers" });
  await appendWorkflowEvent(input.layout, { type: "design-review-failed-reviewers-retried", phase: "design-review", details: { reviewRunId: input.reviewRun.reviewRunId, attemptId: attempt.attemptId, reviewerRoles: retryRoles, retriedAt: new Date().toISOString() } });
  await appendWorkflowEvent(input.layout, { type: "design-review-attempt-started", phase: "design-review", details: { reviewRunId: input.reviewRun.reviewRunId, attemptId: attempt.attemptId, reviewerRoles: retryRoles, startedAt: attempt.startedAt } });

  const retryResults = await runDesignReviewers({ mode: "full", reviewRunId: input.reviewRun.reviewRunId, artifact, state: input.state, options: input.options, selectedFullReviewerRoles: retryRoles });
  let run = input.reviewRun;
  for (const result of retryResults) {
    await writeAttemptReviewerResult(input.layout, run, attempt, result);
    run = await writeReviewerResult(input.layout, run, result);
  }
  const effective = mergeEffectiveResults(previousResults, retryResults);
  const succeeded = retryResults.filter((result) => result.status === "succeeded").map((result) => result.reviewerRole as FullDesignReviewerRole);
  const failed = retryResults.filter((result) => result.status === "failed").map((result) => result.reviewerRole as FullDesignReviewerRole);
  const completedAttempt = await completeDesignReviewAttempt(input.layout, run, attempt, { succeededReviewers: succeeded, failedReviewers: failed });
  await appendWorkflowEvent(input.layout, {
    type: "design-review-attempt-completed",
    phase: "design-review",
    details: { reviewRunId: run.reviewRunId, attemptId: completedAttempt.attemptId, reviewerRoles: completedAttempt.reviewerRoles, succeededReviewerRoles: completedAttempt.succeededReviewers, failedReviewerRoles: completedAttempt.failedReviewers, completedAt: completedAttempt.completedAt },
  });
  const coverage = computeDesignReviewCoverage({ selectedReviewerRoles: previousCoverage.selectedReviewers, reviewerResults: effective });
  await writeCoverage(input.layout, run, coverage);
  const successfulResults = effective.filter((result) => result.status === "succeeded");
  const failedResults = effective.filter((result) => result.status === "failed");
  const aggregate = failedResults.length > 0 && successfulResults.length > 0
    ? aggregatePartialDesignReviewFindings({ reviewRunId: run.reviewRunId, designRef: artifact.ref, successfulResults, failedResults, coverage })
    : aggregateDesignReviewFindings({ reviewRunId: run.reviewRunId, designRef: artifact.ref, findings: successfulResults.flatMap((result) => result.findings), forcedStatus: failedResults.length > 0 ? "failed" : undefined, coverage });
  run = await writeAggregatedFindings(input.layout, run, aggregate);
  run = await writeReadiness(input.layout, run, aggregate.readiness);
  run = { ...run, status: aggregate.status, error: failedResults[0]?.error, completedAt: new Date().toISOString() };
  await writeDesignReviewRun(input.layout, run);
  return { reviewRunId: run.reviewRunId, mode: run.mode, status: aggregate.status, designRef: artifact.ref, aggregate, readiness: aggregate.readiness, ledgerPath: run.ledgerPath, error: run.error };
}

function mergeEffectiveResults(previous: readonly DesignReviewerResult[], retry: readonly DesignReviewerResult[]): DesignReviewerResult[] {
  const byRole = new Map<string, DesignReviewerResult>();
  for (const result of previous) byRole.set(result.reviewerRole, result);
  for (const result of retry) byRole.set(result.reviewerRole, result);
  return [...byRole.values()];
}
