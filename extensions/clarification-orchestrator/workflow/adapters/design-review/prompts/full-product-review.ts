import { buildFullReviewerPrompt, buildFullReviewerSystemPrompt, type FullReviewPromptInput } from "./full-review-shared.ts";

const roleName = "Product Reviewer";
const focus = "problem statement clarity, primary users and roles, goals, measurable success criteria, non-goals, scope boundaries, unresolved product decisions, and whether the design is ready to be converted into requirements and planning tasks";

export function buildProductDesignReviewSystemPrompt(): string {
  return buildFullReviewerSystemPrompt({ roleName, focus });
}

export function buildProductDesignReviewPrompt(input: FullReviewPromptInput): string {
  return buildFullReviewerPrompt({ ...input, roleName, focus, defaultCategory: "product" });
}
