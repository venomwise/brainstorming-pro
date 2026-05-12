import { buildPlanReviewerPrompt, type PlanReviewerPromptInput } from "./shared.ts";

export function buildTaskCoverageReviewerPrompt(input: Omit<PlanReviewerPromptInput, "role">): { systemPrompt: string; prompt: string } {
  return buildPlanReviewerPrompt({ ...input, role: "task-coverage-reviewer" });
}
