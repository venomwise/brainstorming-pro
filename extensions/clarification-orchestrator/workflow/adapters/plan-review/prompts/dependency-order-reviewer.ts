import { buildPlanReviewerPrompt, type PlanReviewerPromptInput } from "./shared.ts";

export function buildDependencyOrderReviewerPrompt(input: Omit<PlanReviewerPromptInput, "role">): { systemPrompt: string; prompt: string } {
  return buildPlanReviewerPrompt({ ...input, role: "dependency-order-reviewer" });
}
