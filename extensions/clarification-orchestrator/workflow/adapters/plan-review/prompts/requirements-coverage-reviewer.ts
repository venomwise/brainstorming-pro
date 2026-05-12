import { buildPlanReviewerPrompt, type PlanReviewerPromptInput } from "./shared.ts";

export function buildRequirementsCoverageReviewerPrompt(input: Omit<PlanReviewerPromptInput, "role">): { systemPrompt: string; prompt: string } {
  return buildPlanReviewerPrompt({ ...input, role: "requirements-coverage-reviewer" });
}
