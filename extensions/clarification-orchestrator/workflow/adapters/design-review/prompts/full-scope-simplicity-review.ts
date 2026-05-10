import { buildFullReviewerPrompt, buildFullReviewerSystemPrompt, type FullReviewPromptInput } from "./full-review-shared.ts";

const roleName = "Scope / Simplicity Reviewer";
const focus = "YAGNI, over-abstraction, accidental inclusion of future specs, spec boundary discipline, separation from later design-review execution-control/triage/revision work, complexity, and long-term maintainability";

export function buildScopeSimplicityDesignReviewSystemPrompt(): string {
  return buildFullReviewerSystemPrompt({ roleName, focus });
}

export function buildScopeSimplicityDesignReviewPrompt(input: FullReviewPromptInput): string {
  return buildFullReviewerPrompt({ ...input, roleName, focus, defaultCategory: "scope-simplicity" });
}
