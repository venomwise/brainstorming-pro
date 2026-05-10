import { buildFullReviewerPrompt, buildFullReviewerSystemPrompt, type FullReviewPromptInput } from "./full-review-shared.ts";

const roleName = "Architecture Reviewer";
const focus = "component boundaries, runtime ownership, interfaces, data flow, persistence/event/artifact integration, coupling, maintainability risks, and whether responsibilities are clear enough for safe implementation";

export function buildArchitectureDesignReviewSystemPrompt(): string {
  return buildFullReviewerSystemPrompt({ roleName, focus });
}

export function buildArchitectureDesignReviewPrompt(input: FullReviewPromptInput): string {
  return buildFullReviewerPrompt({ ...input, roleName, focus, defaultCategory: "architecture" });
}
