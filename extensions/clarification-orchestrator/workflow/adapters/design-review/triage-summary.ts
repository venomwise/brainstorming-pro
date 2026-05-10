import type { DesignReviewTriageReport } from "./types.ts";

export function buildDesignReviewUserFacingSummary(report: Pick<DesignReviewTriageReport, "clusters" | "conflicts" | "unresolvedQuestions" | "coverage" | "readiness">): string {
  const mustFix = report.clusters.filter((cluster) => cluster.triageLevel === "must-fix").length;
  const shouldFix = report.clusters.filter((cluster) => cluster.triageLevel === "should-fix").length;
  const notes = report.clusters.filter((cluster) => cluster.triageLevel === "note").length;
  const blockingConflicts = report.conflicts.filter((conflict) => conflict.impact === "blocking-approval-readiness").length;
  const blockingQuestions = report.unresolvedQuestions.filter((question) => question.blocking).length;
  const parts = [`Triage: ${mustFix} must-fix, ${shouldFix} should-fix, ${notes} note(s).`];
  if (report.conflicts.length > 0) parts.push(`${report.conflicts.length} conflict(s), including ${blockingConflicts} blocking conflict(s).`);
  if (report.unresolvedQuestions.length > 0) parts.push(`${report.unresolvedQuestions.length} unresolved question(s), including ${blockingQuestions} blocking question(s).`);
  if (report.coverage.hasIncompleteCoverage) parts.push(`Coverage is incomplete: ${report.coverage.failedReviewers.length} selected reviewer(s) failed and ${report.coverage.succeededReviewers.length} succeeded.`);
  parts.push(readinessSentence(report.readiness.status));
  return parts.join(" ");
}

function readinessSentence(status: DesignReviewTriageReport["readiness"]["status"]): string {
  if (status === "ready-for-user-approval") return "Ready for explicit user approval; triage does not approve the design.";
  if (status === "blocked") return "Not approval-ready: revise design or resolve blocking questions.";
  if (status === "incomplete-review") return "Not fully review-passed: retry failed reviewers or explicitly accept incomplete review.";
  if (status === "failed") return "Not approval-ready: inspect review failure or retry.";
  if (status === "skipped-by-user") return "Review was skipped and is not approval.";
  return "Not approval-ready.";
}
