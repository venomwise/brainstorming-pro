import type { AgentRunError } from "../../../runtime/agent-execution/types.ts";
import type { PlanReviewAggregate, PlanReviewArtifactBinding, PlanReviewFinding, PlanReviewerRole } from "./types.ts";

export function aggregatePlanReview(input: {
  reviewRunId: string;
  artifactBinding: PlanReviewArtifactBinding;
  findings: PlanReviewFinding[];
  reviewerResults: Array<{ reviewerRole: PlanReviewerRole; status: "succeeded" | "failed"; error?: AgentRunError }>;
}): PlanReviewAggregate {
  return {
    reviewRunId: input.reviewRunId,
    artifactBinding: input.artifactBinding,
    findings: [...input.findings],
    reviewerResults: input.reviewerResults,
    counts: {
      blocking: input.findings.filter((finding) => finding.severity === "blocking").length,
      major: input.findings.filter((finding) => finding.severity === "major").length,
      minor: input.findings.filter((finding) => finding.severity === "minor").length,
      note: input.findings.filter((finding) => finding.severity === "note").length,
      requiresPlanRevision: input.findings.filter((finding) => finding.requiresPlanRevision).length,
      requiresDesignRevision: input.findings.filter((finding) => finding.requiresDesignRevision).length,
    },
  };
}
