import type { PlanReviewPanelViewModel } from "../review-panel-view-model.ts";
import { artifactLabel } from "../review-panel-view-model.ts";

const fixedPlanReviewers = new Set(["requirements-coverage-reviewer", "task-coverage-reviewer", "dependency-order-reviewer"]);

export function renderPlanReviewView(view: PlanReviewPanelViewModel): string[] {
  const lines: string[] = [];
  lines.push(`Plan review ${view.reviewRunId ?? "run unavailable"}: ${view.status}`);
  lines.push("Plan review is automatic and fixed.");
  lines.push("There is no skip/minimal/full mode and no reviewer subset selection.");
  lines.push("Readiness is not plan approval.");
  lines.push(`Approved design: ${artifactLabel(view.approvedDesignRef)}`);
  lines.push(`Requirements: ${artifactLabel(view.requirementsRef)}`);
  lines.push(`Tasks: ${artifactLabel(view.tasksRef)}`);
  if (view.readiness) lines.push(`Readiness: ${view.readiness.status}`);
  for (const reviewer of view.reviewers.filter((reviewer) => fixedPlanReviewers.has(reviewer.reviewerId))) {
    lines.push(`${reviewer.reviewerId}: ${reviewer.status}${reviewer.findingCounts?.total === undefined ? "" : `, ${reviewer.findingCounts.total} findings`}`);
  }
  for (const reviewer of view.reviewers.filter((reviewer) => !fixedPlanReviewers.has(reviewer.reviewerId))) {
    lines.push(`Diagnostic: unsupported plan reviewer ignored in controls context: ${reviewer.reviewerId}`);
  }
  if (view.automaticRevision) {
    const revision = view.automaticRevision;
    lines.push(`Automatic plan revision: ${revision.attemptNumber}/${revision.maxAttempts} ${revision.status}`);
    if (revision.reason) lines.push(`Revision reason: ${revision.reason}`);
    if (revision.sourceRequirementsRef) lines.push(`Source requirements: ${artifactLabel(revision.sourceRequirementsRef)}`);
    if (revision.sourceTasksRef) lines.push(`Source tasks: ${artifactLabel(revision.sourceTasksRef)}`);
    if (revision.revisedRequirementsRef) lines.push(`Revised requirements: ${artifactLabel(revision.revisedRequirementsRef)}`);
    if (revision.revisedTasksRef) lines.push(`Revised tasks: ${artifactLabel(revision.revisedTasksRef)}`);
    if (revision.postRevisionReviewRunId) lines.push(`Post-revision plan review: ${revision.postRevisionReviewRunId}`);
    if ((revision.status === "failed" || revision.status === "exhausted") && revision.blockersRemaining) lines.push("Use /brainstorm-pro --resume for runtime-gated recovery; no plan review controls are available here.");
  }
  return lines;
}
