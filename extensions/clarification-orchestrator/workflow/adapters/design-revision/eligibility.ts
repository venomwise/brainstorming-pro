import type { WorkflowLayout } from "../../artifact-store.ts";
import { assertLatestDesignBinding, bindDesignRevisionSources, type BoundDesignRevisionSources } from "./source-binding.ts";
import { evaluateRevisionRoundPolicy, type RevisionRoundPolicyResult } from "./round-policy.ts";
import { evaluateUserQuestionGate, type UserQuestionGateResult } from "./user-questions.ts";
import type { DesignReviewRun } from "../design-review/types.ts";
import type { DesignRevisionAuthorization } from "./types.ts";

export type RevisionEligibilityDenialReason =
  | "stale-source"
  | "no-actionable-input"
  | "failed-review-evidence"
  | "path-escape"
  | "revision-exhausted"
  | "needs-user-input"
  | "unknown-user-answer";

export type RevisionEligibilityResult =
  | { status: "eligible"; sources: BoundDesignRevisionSources; roundPolicy: RevisionRoundPolicyResult; userQuestionGate: Extract<UserQuestionGateResult, { status: "ready" }> }
  | { status: "denied"; reason: RevisionEligibilityDenialReason; message: string; sources?: BoundDesignRevisionSources; roundPolicy?: RevisionRoundPolicyResult; userQuestionGate?: UserQuestionGateResult };

export async function evaluateRevisionEligibility(input: {
  layout: WorkflowLayout;
  authorization: DesignRevisionAuthorization;
  reviewRun?: DesignReviewRun;
  currentPhase?: string;
}): Promise<RevisionEligibilityResult> {
  try {
    await assertLatestDesignBinding(input.layout, input.authorization.sourceDesignRef);
  } catch (error) {
    return denied("stale-source", errorMessage(error));
  }

  const roundPolicy = await evaluateRevisionRoundPolicy(input.layout, input.authorization.roundPolicy);
  if (roundPolicy.status === "revision-exhausted") return denied("revision-exhausted", roundPolicy.reason, { roundPolicy });

  let sources: BoundDesignRevisionSources;
  try {
    sources = await bindDesignRevisionSources(input.layout, input.authorization, input.reviewRun);
  } catch (error) {
    const message = errorMessage(error);
    const reason: RevisionEligibilityDenialReason = /path|outside|escape/iu.test(message) ? "path-escape" : "stale-source";
    return denied(reason, message, { roundPolicy });
  }

  if (sources.reviewRun.status === "failed" && !sources.reviewRun.aggregateResult) {
    return denied("failed-review-evidence", "Source review failed without usable aggregate or triage output.", { sources, roundPolicy });
  }

  if (!hasActionableInput(sources, input.authorization)) {
    return denied("no-actionable-input", "No actionable findings, unresolved questions, or user revision instructions are present.", { sources, roundPolicy });
  }

  const userQuestionGate = evaluateUserQuestionGate(sources.triage, input.authorization.userAnswers);
  if (userQuestionGate.status === "invalid-answers") {
    return denied("unknown-user-answer", `User answers reference unknown question IDs: ${userQuestionGate.unknownQuestionIds.join(", ")}`, { sources, roundPolicy, userQuestionGate });
  }
  if (userQuestionGate.status === "needs-user-input") {
    return denied("needs-user-input", `Revision requires user answers for question IDs: ${userQuestionGate.missingQuestionIds.join(", ")}`, { sources, roundPolicy, userQuestionGate });
  }

  return { status: "eligible", sources, roundPolicy, userQuestionGate };
}

function hasActionableInput(sources: BoundDesignRevisionSources, authorization: DesignRevisionAuthorization): boolean {
  if (authorization.userInstructions && authorization.userInstructions.trim().length > 0) return true;
  if (["blocked", "not-ready", "failed", "incomplete-review"].includes(sources.readiness.status)) return true;
  if (sources.triage.readiness.recommendedNextAction === "revise-design") return true;
  if (sources.triage.clusters.some((cluster) => cluster.triageLevel === "must-fix" || cluster.requiresRevision)) return true;
  if (sources.triage.conflicts.some((conflict) => conflict.impact !== "informational")) return true;
  if (sources.triage.unresolvedQuestions.length > 0) return true;
  return false;
}

function denied(reason: RevisionEligibilityDenialReason, message: string, extra: Omit<Extract<RevisionEligibilityResult, { status: "denied" }>, "status" | "reason" | "message"> = {}): RevisionEligibilityResult {
  return { status: "denied", reason, message, ...extra };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
