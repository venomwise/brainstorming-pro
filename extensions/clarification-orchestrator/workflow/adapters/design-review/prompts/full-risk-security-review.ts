import { buildFullReviewerPrompt, buildFullReviewerSystemPrompt, type FullReviewPromptInput } from "./full-review-shared.ts";

const roleName = "Risk / Security Reviewer";
const focus = "path traversal, topic scoping, stale artifact/version/checksum risk, approval gate bypass risk, untrusted output handling, model/tool/session policy, fail-closed behavior, audit integrity, and trust-boundary violations";

export function buildRiskSecurityDesignReviewSystemPrompt(): string {
  return buildFullReviewerSystemPrompt({ roleName, focus });
}

export function buildRiskSecurityDesignReviewPrompt(input: FullReviewPromptInput): string {
  return buildFullReviewerPrompt({ ...input, roleName, focus, defaultCategory: "risk-security" });
}
