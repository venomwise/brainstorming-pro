import type { DesignApprovalReadiness, DesignReviewConflict, DesignReviewFindingCluster, DesignReviewReadinessReport, DesignReviewUnresolvedQuestion } from "./types.ts";

export function buildDesignReviewReadinessReport(input: {
  sourceReadiness: DesignApprovalReadiness;
  clusters: readonly DesignReviewFindingCluster[];
  conflicts: readonly DesignReviewConflict[];
  unresolvedQuestions: readonly DesignReviewUnresolvedQuestion[];
}): DesignReviewReadinessReport {
  const mustFixClusters = input.clusters.filter((cluster) => cluster.triageLevel === "must-fix");
  const blockingConflicts = input.conflicts.filter((conflict) => conflict.impact === "blocking-approval-readiness");
  const blockingQuestions = input.unresolvedQuestions.filter((question) => question.blocking);
  const blockingFindingIds = [...new Set(mustFixClusters.flatMap((cluster) => cluster.sourceFindingIds))].sort();
  const status = statusFor(input.sourceReadiness.status, mustFixClusters.length, blockingConflicts.length, blockingQuestions.length);
  return {
    status,
    sourceReadiness: input.sourceReadiness,
    recommendedNextAction: nextActionFor(status, blockingQuestions.length, input.sourceReadiness.status),
    blockingFindingIds,
    blockingConflictIds: blockingConflicts.map((conflict) => conflict.conflictId).sort(),
    blockingQuestionIds: blockingQuestions.map((question) => question.questionId).sort(),
    summary: summaryFor(status, mustFixClusters.length, blockingConflicts.length, blockingQuestions.length, input.sourceReadiness.summary),
  };
}

function statusFor(sourceStatus: DesignApprovalReadiness["status"], mustFixCount: number, blockingConflictCount: number, blockingQuestionCount: number): DesignApprovalReadiness["status"] {
  if (sourceStatus === "skipped-by-user") return "skipped-by-user";
  if (sourceStatus === "failed" || sourceStatus === "not-ready") return sourceStatus;
  if (mustFixCount > 0 || blockingConflictCount > 0 || blockingQuestionCount > 0) return "blocked";
  if (sourceStatus === "incomplete-review") return "incomplete-review";
  return sourceStatus === "ready-for-user-approval" ? "ready-for-user-approval" : sourceStatus;
}

function nextActionFor(status: DesignApprovalReadiness["status"], blockingQuestionCount: number, sourceStatus: DesignApprovalReadiness["status"]): DesignReviewReadinessReport["recommendedNextAction"] {
  if (status === "ready-for-user-approval") return "approve-design";
  if (status === "incomplete-review") return "accept-incomplete-or-retry";
  if (status === "failed" || sourceStatus === "failed") return "inspect-failure-or-retry";
  if (status === "blocked" && blockingQuestionCount > 0) return "resolve-user-questions";
  if (status === "blocked") return "revise-design";
  return "review-summary";
}

function summaryFor(status: DesignApprovalReadiness["status"], mustFixCount: number, blockingConflictCount: number, blockingQuestionCount: number, sourceSummary: string): string {
  if (status === "skipped-by-user") return "Review was skipped by user; triage does not imply design approval.";
  if (status === "failed") return "Design review failed; inspect failure details or retry eligible reviewers.";
  if (status === "incomplete-review") return "Design review is incomplete; retry failed reviewers or explicitly accept incomplete review before approval.";
  if (status === "blocked") return `Design review triage is blocked by ${mustFixCount} must-fix issue(s), ${blockingConflictCount} blocking conflict(s), and ${blockingQuestionCount} blocking question(s).`;
  if (status === "ready-for-user-approval") return "Design review triage is ready for explicit user approval; triage itself is not approval.";
  return sourceSummary;
}
