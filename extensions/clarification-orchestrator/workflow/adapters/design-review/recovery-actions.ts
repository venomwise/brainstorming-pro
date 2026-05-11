import type { VersionedArtifactRef } from "../../types.ts";
import { FULL_DESIGN_REVIEWER_ORDER } from "./full-reviewer-registry.ts";
import type { DesignApprovalReadiness, DesignReviewCoverage, DesignReviewRecoveryAction, DesignReviewRun } from "./types.ts";

export function buildDesignReviewRecoveryActions(input: {
  reviewRunId: string;
  ledgerPath?: string;
  designRef: VersionedArtifactRef;
  status: DesignReviewRun["status"] | "partial" | "blocked" | "failed";
  readiness: DesignApprovalReadiness;
  coverage?: DesignReviewCoverage;
  ledgerHealthy?: boolean;
  staleArtifact?: boolean;
}): DesignReviewRecoveryAction[] {
  const actions: DesignReviewRecoveryAction[] = [];
  const coverage = input.coverage;
  if (coverage && coverage.failedReviewers.length > 0 && !input.staleArtifact && input.ledgerHealthy !== false) {
    actions.push({ type: "retry-failed-reviewers", reviewRunId: input.reviewRunId, reviewerRoles: coverage.failedReviewers });
  }
  if (input.readiness.status === "incomplete-review" && coverage && isSafeAcceptIncomplete(coverage, input)) {
    actions.push({ type: "accept-incomplete-review", reviewRunId: input.reviewRunId, designRef: input.designRef, coverage });
  }
  if (!input.staleArtifact && input.ledgerHealthy !== false && (input.readiness.status === "blocked" || input.readiness.blockingFindingIds.length > 0)) {
    actions.push({ type: "revise-design-once", reviewRunId: input.reviewRunId, designRef: input.designRef, blockingQuestionIds: input.readiness.unresolvedUserQuestions, ledgerPath: input.ledgerPath ?? "" });
  }
  if (!input.staleArtifact && input.readiness.unresolvedUserQuestions.length > 0) {
    actions.push({ type: "answer-design-revision-questions", reviewRunId: input.reviewRunId, designRef: input.designRef, questionIds: input.readiness.unresolvedUserQuestions });
  }
  if (input.staleArtifact || input.status === "failed") {
    actions.push({ type: "replace-review-selection", designRef: input.designRef, availableReviewerRoles: [...FULL_DESIGN_REVIEWER_ORDER] });
  }
  if (input.ledgerPath) actions.push({ type: "view-review-ledger", reviewRunId: input.reviewRunId, ledgerPath: input.ledgerPath });
  return actions;
}

function isSafeAcceptIncomplete(coverage: DesignReviewCoverage, input: { readiness: DesignApprovalReadiness; ledgerHealthy?: boolean; staleArtifact?: boolean }): boolean {
  return input.ledgerHealthy !== false
    && !input.staleArtifact
    && input.readiness.blockingFindingIds.length === 0
    && coverage.succeededReviewers.length > 0
    && coverage.failedReviewers.length > 0;
}
