import type { DesignApprovalReadiness, DesignReviewFinding, DesignReviewPanelStatus } from "./types.ts";

export function evaluateDesignApprovalReadiness(input: { status: DesignReviewPanelStatus; findings?: DesignReviewFinding[] }): DesignApprovalReadiness {
  const findings = input.findings ?? [];
  const blockingFindingIds = findings.filter((finding) => finding.severity === "blocking").map((finding) => finding.id);
  const unresolvedUserQuestions = findings.flatMap((finding) => finding.userQuestion ? [finding.userQuestion] : []);
  if (input.status === "skipped") return { status: "skipped-by-user", blockingFindingIds: [], unresolvedUserQuestions: [], summary: "Review was skipped by user; this is not design approval." };
  if (input.status === "unavailable") return { status: "not-ready", blockingFindingIds: [], unresolvedUserQuestions: [], summary: "Requested design review is unavailable and is not approval-ready." };
  if (input.status === "failed") return { status: "failed", blockingFindingIds, unresolvedUserQuestions, summary: "Design review failed; design is not approval-ready." };
  if (input.status === "blocked" || blockingFindingIds.length > 0) return { status: "blocked", blockingFindingIds, unresolvedUserQuestions, summary: "Design review found blocking issues; revision or user resolution is required." };
  return { status: "ready-for-user-approval", blockingFindingIds: [], unresolvedUserQuestions, summary: "Design review passed; user approval is still required." };
}
