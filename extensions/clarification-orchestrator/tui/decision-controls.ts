import type { WorkflowDecisionResult } from "../workflow/decision-facade.ts";
import type { FullDesignReviewerRole, ReviewMode } from "../workflow/types.ts";
import { buildAcceptIncompletePayload, buildApprovalPayload, buildDesignRevisionAuthorizationPayload, buildInteractiveGateModel, buildRetryDesignReviewersPayload, buildReviewModePayload, buildRevisePayload, type AcceptIncompleteGateModel, type DecisionPayload, type DesignApprovalGateModel, type DesignReviewModeGateModel, type DesignReviewRecoveryGateModel, type DesignRevisionAuthorizationGateModel, type InteractiveGateModel, type PlanApprovalGateModel } from "./interactive-gates.ts";

export { buildInteractiveGateModel };
export type { InteractiveGateModel } from "./interactive-gates.ts";

export const FULL_DESIGN_REVIEWER_ROLES: FullDesignReviewerRole[] = [
  "product-reviewer",
  "architecture-reviewer",
  "risk-security-reviewer",
  "testing-reviewer",
  "scope-simplicity-reviewer",
];

export type ReviewModeControlState = {
  selectedMode: ReviewMode | "revise" | "exit";
  skipConfirmed: boolean;
  selectedFullReviewerRoles: FullDesignReviewerRole[];
};

export type ConfirmationState = {
  confirmed: boolean;
};

export function createReviewModeControlState(): ReviewModeControlState {
  return { selectedMode: "minimal", skipConfirmed: false, selectedFullReviewerRoles: [...FULL_DESIGN_REVIEWER_ROLES] };
}

export function validateFullReviewerSelection(roles: readonly string[]): { valid: true; roles: FullDesignReviewerRole[] } | { valid: false; reason: string } {
  if (!roles.length) return { valid: false, reason: "Select at least one full design reviewer." };
  const seen = new Set<string>();
  const validRoles: FullDesignReviewerRole[] = [];
  for (const role of roles) {
    if (seen.has(role)) return { valid: false, reason: `Duplicate reviewer role: ${role}` };
    seen.add(role);
    if (!isFullDesignReviewerRole(role)) return { valid: false, reason: `Unsupported reviewer role: ${role}` };
    validRoles.push(role);
  }
  return { valid: true, roles: validRoles };
}

export function canSubmitReviewMode(state: ReviewModeControlState): boolean {
  if (state.selectedMode === "skip") return state.skipConfirmed;
  if (state.selectedMode === "full") return validateFullReviewerSelection(state.selectedFullReviewerRoles).valid;
  return true;
}

export function buildDesignReviewModeSubmission(model: DesignReviewModeGateModel, state: ReviewModeControlState, user: string): DecisionPayload {
  if (!model.enabled) throw new Error("Design review controls are disabled for this gate.");
  if (state.selectedMode === "revise" || state.selectedMode === "exit") throw new Error(`${state.selectedMode} is not a review mode submission.`);
  if (!canSubmitReviewMode(state)) throw new Error("Design review mode submission requires valid state and confirmation.");
  return buildReviewModePayload(model, state.selectedMode, user);
}

export function renderDesignReviewModeControl(model: DesignReviewModeGateModel, state: ReviewModeControlState): string[] {
  const lines = [
    "Design review decision",
    `Design: ${model.designRef ? `${model.designRef.path} v${model.designRef.version}@${model.designRef.checksum.slice(0, 12)}` : "unavailable"}`,
    "Choices: skip, minimal, full, revise, exit",
    "Skip is an explicit recorded decision. Full runs the full design reviewer panel.",
  ];
  if (state.selectedMode === "skip" && !state.skipConfirmed) lines.push("Confirm skip? Default: no/cancel.");
  if (state.selectedMode === "full") lines.push(`Full reviewers: ${state.selectedFullReviewerRoles.join(", ")}`);
  if (!model.enabled) lines.push("Controls disabled; use CLI fallback.");
  lines.push(model.cliFallback);
  return lines;
}

export function renderDesignApprovalControl(model: DesignApprovalGateModel, confirmation: ConfirmationState): string[] {
  return [
    "Design approval",
    `Design: ${model.designRef ? `${model.designRef.path} v${model.designRef.version}@${model.designRef.checksum.slice(0, 12)}` : "unavailable"}`,
    "Review readiness is not approval.",
    confirmation.confirmed ? "Approval confirmed; Enter submits." : "Confirm approval? Default: no/cancel.",
    model.cliFallback,
  ];
}

export function renderDesignReviewRecoveryControl(model: DesignReviewRecoveryGateModel): string[] {
  return [
    "Design review recovery",
    `Review run: ${model.reviewRunId ?? "unavailable"}`,
    `Selected reviewers: ${model.selectedReviewers.join(", ") || "none"}`,
    `Succeeded reviewers: ${model.succeededReviewers.join(", ") || "none"}`,
    `Failed reviewers: ${model.failedReviewers.join(", ") || "none"}`,
    model.diagnosticsSummary ? `Diagnostics: ${model.diagnosticsSummary}` : "Diagnostics: unavailable",
    "Retry submits only runtime-exposed failed reviewer roles.",
    model.cliFallback,
  ];
}

export function renderAcceptIncompleteControl(model: AcceptIncompleteGateModel, confirmation: ConfirmationState): string[] {
  return [
    "Accept incomplete design review",
    "Incomplete review is not passed review and does not approve design.",
    `Review run: ${model.reviewRunId ?? "unavailable"}`,
    `Blocking findings: ${model.blockingFindingCount ?? 0}`,
    model.coverageChecksum ? `Coverage checksum: ${model.coverageChecksum}` : "Coverage checksum: unavailable",
    confirmation.confirmed ? "Accept incomplete confirmed; Enter submits." : "Confirm accept incomplete? Default: no/cancel.",
    model.cliFallback,
  ];
}

export function renderDesignRevisionAuthorizationControl(model: DesignRevisionAuthorizationGateModel, confirmation: ConfirmationState): string[] {
  return [
    "Authorize design revision",
    `Source design: ${model.sourceDesignRef ? `${model.sourceDesignRef.path} v${model.sourceDesignRef.version}@${model.sourceDesignRef.checksum.slice(0, 12)}` : "unavailable"}`,
    `Source review run: ${model.sourceReviewRunId ?? "unavailable"}`,
    "One authorization permits one revision attempt and one post-revision re-review only.",
    "Authorization does not approve the revised design and does not allow automatic multi-round revision.",
    confirmation.confirmed ? "Authorization confirmed; Enter submits." : "Confirm revision authorization? Default: no/cancel.",
    model.cliFallback,
  ];
}

export function buildDesignApprovalSubmission(model: DesignApprovalGateModel, confirmation: ConfirmationState, user: string): DecisionPayload {
  if (!confirmation.confirmed) throw new Error("Design approval requires explicit confirmation.");
  return buildApprovalPayload(model, user);
}

export function buildDesignReviseSubmission(model: DesignApprovalGateModel, user: string): DecisionPayload {
  return buildRevisePayload(model, user);
}

export function buildAcceptIncompleteSubmission(model: AcceptIncompleteGateModel, confirmation: ConfirmationState, user: string): DecisionPayload {
  if (!confirmation.confirmed) throw new Error("Accept incomplete requires explicit confirmation.");
  return buildAcceptIncompletePayload(model, user, confirmation.confirmed);
}

export function buildRetryDesignReviewersSubmission(model: DesignReviewRecoveryGateModel, user: string): DecisionPayload {
  return buildRetryDesignReviewersPayload(model, user);
}

export function buildDesignRevisionAuthorizationSubmission(model: DesignRevisionAuthorizationGateModel, confirmation: ConfirmationState, user: string): DecisionPayload {
  if (!confirmation.confirmed) throw new Error("Design revision authorization requires explicit confirmation.");
  return buildDesignRevisionAuthorizationPayload(model, user, confirmation.confirmed);
}

export function renderPlanApprovalControl(model: PlanApprovalGateModel, confirmation: ConfirmationState): string[] {
  return [
    "Plan approval",
    `Requirements: ${model.requirementsRef ? `${model.requirementsRef.path} v${model.requirementsRef.version}@${model.requirementsRef.checksum.slice(0, 12)}` : "unavailable"}`,
    `Tasks: ${model.tasksRef ? `${model.tasksRef.path} v${model.tasksRef.version}@${model.tasksRef.checksum.slice(0, 12)}` : "unavailable"}`,
    "Plan review ready is not plan approval.",
    "Plan review mode/subset/partial accept/retry controls are not available.",
    confirmation.confirmed ? "Approval confirmed; Enter submits." : "Confirm plan approval? Default: no/cancel.",
    model.cliFallback,
  ];
}

export function buildPlanApprovalSubmission(model: PlanApprovalGateModel, confirmation: ConfirmationState, user: string): DecisionPayload {
  if (!confirmation.confirmed) throw new Error("Plan approval requires explicit confirmation.");
  return buildApprovalPayload(model, user);
}

export function renderDecisionResult(result: WorkflowDecisionResult): string[] {
  if (result.ok) return [result.idempotent ? "Decision was already accepted for this idempotency key." : "Decision accepted by runtime."];
  return [`Decision rejected: ${result.reason}`, result.message, "No decision was recorded."];
}

export function renderInteractiveGateControl(model: InteractiveGateModel): string[] {
  if (model.kind === "design-review-mode") return renderDesignReviewModeControl(model, createReviewModeControlState());
  if (model.kind === "design-approval") return renderDesignApprovalControl(model, { confirmed: false });
  if (model.kind === "plan-approval") return renderPlanApprovalControl(model, { confirmed: false });
  if (model.kind === "design-review-recovery") return renderDesignReviewRecoveryControl(model);
  if (model.kind === "accept-incomplete-design-review") return renderAcceptIncompleteControl(model, { confirmed: false });
  if (model.kind === "design-revision-authorization") return renderDesignRevisionAuthorizationControl(model, { confirmed: false });
  return [model.warnings[0] ?? "No interactive workflow controls available.", model.cliFallback];
}

function isFullDesignReviewerRole(role: string): role is FullDesignReviewerRole {
  return FULL_DESIGN_REVIEWER_ROLES.includes(role as FullDesignReviewerRole);
}
