import type { PlanReviewArtifactBinding, PlanReviewFinding, PlanReviewFindingDraft, PlanReviewerRole } from "./types.ts";
import { validatePlanReviewFindingDraft } from "./schemas.ts";

export function normalizePlanReviewFindings(input: { reviewRunId: string; reviewerRole: PlanReviewerRole | "shape-validator"; binding: PlanReviewArtifactBinding; drafts: PlanReviewFindingDraft[] }): PlanReviewFinding[] {
  return input.drafts.map((draft, index) => {
    const valid = validatePlanReviewFindingDraft(sanitizeDraft(draft), `findings[${index}]`);
    return {
      ...valid,
      id: `${input.reviewRunId}-${input.reviewerRole}-${index + 1}`,
      reviewRunId: input.reviewRunId,
      reviewerRole: input.reviewerRole,
      artifactBinding: input.binding,
    };
  });
}

function sanitizeDraft(draft: PlanReviewFindingDraft): PlanReviewFindingDraft {
  return {
    ...draft,
    title: sanitizeText(draft.title),
    description: sanitizeText(draft.description),
    recommendation: draft.recommendation ? sanitizeText(draft.recommendation) : draft.recommendation,
    evidence: draft.evidence ? sanitizeText(draft.evidence) : draft.evidence,
    affectedArtifacts: draft.affectedArtifacts.filter((artifact) => artifact === "design" || artifact === "requirements" || artifact === "tasks"),
    affectedSections: draft.affectedSections.map(sanitizeText),
  };
}

function sanitizeText(value: string): string {
  return value.replace(/\b(approve\s+(?:the\s+)?plan|start\s+execution|execute\s+tasks|skip\s+gate)\b/giu, "[removed directive]").trim();
}
