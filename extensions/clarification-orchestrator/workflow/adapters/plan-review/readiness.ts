import type { PlanApprovalReadiness, PlanReviewAggregate } from "./types.ts";

export function evaluatePlanApprovalReadiness(input: { aggregate: PlanReviewAggregate; stale?: boolean; failed?: boolean }): PlanApprovalReadiness {
  if (input.stale) return { status: "stale", blockingFindingIds: [], summary: "Plan review is stale because bound artifacts no longer match current artifacts." };
  if (input.failed || input.aggregate.reviewerResults.some((result) => result.status === "failed")) return { status: "failed", blockingFindingIds: [], summary: "Plan review failed because at least one reviewer or validation step failed." };
  const designBlockers = input.aggregate.findings.filter((finding) => finding.requiresDesignRevision);
  if (designBlockers.length > 0) return { status: "blocked-needs-design-revision", blockingFindingIds: designBlockers.map((finding) => finding.id), summary: "Plan review found issues requiring design revision." };
  const planBlockers = input.aggregate.findings.filter((finding) => finding.requiresPlanRevision && (finding.severity === "blocking" || finding.severity === "major"));
  if (planBlockers.length > 0) return { status: "blocked-needs-plan-revision", blockingFindingIds: planBlockers.map((finding) => finding.id), summary: "Plan review found blocking or major issues requiring plan revision." };
  return { status: "ready-for-plan-approval", blockingFindingIds: [], summary: "Plan review passed; explicit user plan approval is still required before execution." };
}
