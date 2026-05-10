import { buildFullReviewerPrompt, buildFullReviewerSystemPrompt, type FullReviewPromptInput } from "./full-review-shared.ts";

const roleName = "Testing Reviewer";
const focus = "unit, integration, security, and documentation test coverage; negative paths and failure modes; fixtures and fixture strategy; deterministic validation; evidence strategy; and how runtime gates, artifact binding, and reviewer behavior will be verified";

export function buildTestingDesignReviewSystemPrompt(): string {
  return buildFullReviewerSystemPrompt({ roleName, focus });
}

export function buildTestingDesignReviewPrompt(input: FullReviewPromptInput): string {
  return buildFullReviewerPrompt({ ...input, roleName, focus, defaultCategory: "testing" });
}
