import type { DesignApprovalReadiness, DesignReviewCoverage, DesignReviewFinding, DesignReviewPanelStatus } from "./types.ts";

export function evaluateDesignApprovalReadiness(input: { status: DesignReviewPanelStatus; findings?: DesignReviewFinding[]; coverage?: DesignReviewCoverage }): DesignApprovalReadiness {
  const findings = input.findings ?? [];
  const blockingFindingIds = findings.filter((finding) => finding.severity === "blocking").map((finding) => finding.id);
  const unresolvedUserQuestions = findings.flatMap((finding) => finding.userQuestion ? [finding.userQuestion] : []);
  if (input.status === "skipped") return { status: "skipped-by-user", blockingFindingIds: [], unresolvedUserQuestions, summary: "Review was skipped by user; this is not design approval." };
  if (input.status === "unavailable") return { status: "not-ready", blockingFindingIds: [], unresolvedUserQuestions, summary: "Requested design review is unavailable and is not approval-ready." };
  if (input.status === "failed") return { status: "failed", blockingFindingIds, unresolvedUserQuestions, summary: "Design review failed; design is not approval-ready." };
  if (input.status === "partial") {
    if (!input.coverage || input.coverage.succeededReviewers.length === 0 || input.coverage.failedReviewers.length === 0 || blockingFindingIds.length > 0) {
      return { status: "failed", blockingFindingIds, unresolvedUserQuestions, summary: "Design review coverage is inconsistent; design is not approval-ready." };
    }
    return { status: "incomplete-review", blockingFindingIds: [], unresolvedUserQuestions, summary: "Design review is incomplete; retry failed reviewers or explicitly accept incomplete review before approval." };
  }
  if (input.status === "blocked" || blockingFindingIds.length > 0) return { status: "blocked", blockingFindingIds, unresolvedUserQuestions, summary: "Design review found blocking issues; revision or user resolution is required." };
  if (input.status === "passed" && input.coverage && input.coverage.failedReviewers.length > 0) {
    return { status: "failed", blockingFindingIds, unresolvedUserQuestions, summary: "Design review coverage is inconsistent; design is not approval-ready." };
  }
  return { status: "ready-for-user-approval", blockingFindingIds: [], unresolvedUserQuestions, summary: "Design review passed; user approval is still required." };
}
