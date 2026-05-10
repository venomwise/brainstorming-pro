import { createWorkflowLayout } from "../../artifact-store.ts";
import type { WorkflowState } from "../../types.ts";
import { bindDesignArtifactForReview } from "./artifact-binding.ts";
import { resolveDesignReviewMode } from "./mode.ts";
import { aggregateDesignReviewFindings } from "./aggregation.ts";
import { evaluateDesignApprovalReadiness } from "./readiness.ts";
import { createDesignReviewRun, ensureReviewLedger, writeAggregatedFindings, writeDesignReviewRun, writeReadiness, writeReviewerResult } from "./review-run-store.ts";
import { resolveFullDesignReviewerSet, runDesignReviewers, type ReviewerCoordinatorOptions } from "./reviewer-coordinator.ts";
import type { DesignReviewPanelResult, DesignReviewRun } from "./types.ts";

export async function runDesignReviewPanel(state: WorkflowState, options: ReviewerCoordinatorOptions): Promise<DesignReviewPanelResult> {
  const decision = state.reviewDecisions.design;
  if (!decision) throw new Error("Design review decision is missing.");
  const layout = await createWorkflowLayout(options.projectRoot, state.topic);
  const mode = resolveDesignReviewMode(decision);
  const artifact = await bindDesignArtifactForReview(layout, state, decision);
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

  if (mode === "full" && !resolveFullDesignReviewerSet()) {
    const readiness = evaluateDesignApprovalReadiness({ status: "unavailable" });
    run = { ...run, status: "unavailable", unavailableReason: "full-review-unavailable", readiness, completedAt: new Date().toISOString() };
    await writeReadiness(layout, run, readiness);
    await writeDesignReviewRun(layout, run);
    return { reviewRunId: run.reviewRunId, mode, status: "unavailable", designRef: artifact.ref, readiness, ledgerPath: run.ledgerPath, unavailableReason: "full-review-unavailable" };
  }

  run = { ...run, status: "running" };
  await writeDesignReviewRun(layout, run);
  const reviewerResults = await runDesignReviewers({ mode, reviewRunId: run.reviewRunId, artifact, state, options });
  for (const result of reviewerResults) {
    run = await writeReviewerResult(layout, run, result);
  }
  const failed = reviewerResults.find((result) => result.status === "failed");
  if (failed) {
    const readiness = evaluateDesignApprovalReadiness({ status: "failed" });
    const aggregate = aggregateDesignReviewFindings({ reviewRunId: run.reviewRunId, designRef: artifact.ref, findings: [], forcedStatus: "failed" });
    run = await writeAggregatedFindings(layout, run, aggregate);
    run = await writeReadiness(layout, run, readiness);
    run = { ...run, status: "failed", error: failed.error, completedAt: new Date().toISOString() };
    await writeDesignReviewRun(layout, run);
    return { reviewRunId: run.reviewRunId, mode, status: "failed", designRef: artifact.ref, aggregate, readiness, ledgerPath: run.ledgerPath, error: failed.error };
  }
  const findings = reviewerResults.flatMap((result) => result.findings);
  const aggregate = aggregateDesignReviewFindings({ reviewRunId: run.reviewRunId, designRef: artifact.ref, findings });
  run = await writeAggregatedFindings(layout, run, aggregate);
  run = await writeReadiness(layout, run, aggregate.readiness);
  run = { ...run, status: aggregate.status, completedAt: new Date().toISOString() };
  await writeDesignReviewRun(layout, run);
  return { reviewRunId: run.reviewRunId, mode, status: aggregate.status, designRef: artifact.ref, aggregate, readiness: aggregate.readiness, ledgerPath: run.ledgerPath };
}
