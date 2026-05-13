import { applyRuntimeUserDecision, getStatus, loadLatestWorkflowState, renderWorkflowStatus, saveWorkflowState, type RuntimeUserDecision, type WorkflowRuntimeStatus } from "./runtime.ts";
import type { PendingGateBinding, UserDecisionRequest, VersionedArtifactRef, WorkflowPhase, WorkflowState } from "./types.ts";

export type WorkflowDecisionSource = "cli-resume" | "tui";

export type WorkflowDecisionBinding = {
  gateId: string;
  gateNonce: string;
  phase: WorkflowPhase;
  artifactRefs: VersionedArtifactRef[];
};

export type WorkflowDecisionIdempotency = {
  key: string;
};

export type SubmitWorkflowDecisionInput = {
  cwd: string;
  topic: string;
  decision: RuntimeUserDecision;
  binding: WorkflowDecisionBinding;
  idempotency: WorkflowDecisionIdempotency;
  source: WorkflowDecisionSource;
};

export type WorkflowDecisionRejectionReason =
  | "stale-gate"
  | "artifact-mismatch"
  | "checksum-mismatch"
  | "duplicate-decision"
  | "unsupported-decision"
  | "phase-mismatch"
  | "missing-pending-decision"
  | "blocked-or-failed"
  | "status-unavailable";

export type WorkflowDecisionAcceptedResult = {
  ok: true;
  idempotent: boolean;
  status?: WorkflowRuntimeStatus;
};

export type WorkflowDecisionRejectedResult = {
  ok: false;
  reason: WorkflowDecisionRejectionReason;
  status?: WorkflowRuntimeStatus;
  message: string;
};

export type WorkflowDecisionResult = WorkflowDecisionAcceptedResult | WorkflowDecisionRejectedResult;

export type DurableDecisionIdempotencyMetadata = {
  idempotencyKey?: string;
  decisionSource?: WorkflowDecisionSource;
};

export async function submitWorkflowDecision(input: SubmitWorkflowDecisionInput): Promise<WorkflowDecisionResult> {
  let state: WorkflowState;
  try {
    state = await loadLatestWorkflowState(input.cwd, input.topic);
  } catch {
    return { ok: false, reason: "status-unavailable", message: "Could not load current workflow status." };
  }

  const status = renderWorkflowStatus(state);
  const idempotent = detectIdempotentAcceptedDecision(state, input);
  if (idempotent) return { ok: true, idempotent: true, status };

  const consumed = detectConsumedGate(state, input);
  if (consumed) return { ok: false, reason: "duplicate-decision", status, message: "The submitted gate was already consumed by a different decision." };

  if (state.phase === "blocked" || state.phase === "failed") {
    return { ok: false, reason: "blocked-or-failed", status, message: "Workflow is blocked or failed and this decision is not an allowed recovery action." };
  }

  if (isCraftedPlanReviewDecision(input.decision)) {
    return { ok: false, reason: "unsupported-decision", status, message: "Plan review mode, subset, partial accept, and per-reviewer retry decisions are not supported." };
  }

  const pending = state.pendingDecision;
  if (!pending?.binding) return { ok: false, reason: "missing-pending-decision", status, message: "No current bound pending decision is available." };

  const bindingValidation = validateBinding(input.binding, pending.binding);
  if (bindingValidation) return { ok: false, reason: bindingValidation, status, message: messageForRejection(bindingValidation) };

  if (!decisionAllowedForPendingGate(input.decision, pending)) {
    return { ok: false, reason: "unsupported-decision", status, message: "Submitted decision is not allowed for the current pending gate." };
  }

  const next = applyRuntimeUserDecision(state, input.decision, { idempotencyKey: input.idempotency.key, decisionSource: input.source });
  if (next === state || next.phase === state.phase && next.pendingDecision === state.pendingDecision) {
    return { ok: false, reason: "unsupported-decision", status, message: "Runtime did not accept the submitted decision." };
  }

  const saved = await saveWorkflowState(input.cwd, next);
  return { ok: true, idempotent: false, status: renderWorkflowStatus(saved) };
}

function isCraftedPlanReviewDecision(decision: RuntimeUserDecision): boolean {
  const candidate = decision as RuntimeUserDecision & { target?: string; reviewerRoles?: unknown; planReviewMode?: unknown; planReviewerSubset?: unknown };
  return candidate.target === "plan" || candidate.planReviewMode !== undefined || candidate.planReviewerSubset !== undefined;
}

function validateBinding(submitted: WorkflowDecisionBinding, current: PendingGateBinding): WorkflowDecisionRejectionReason | undefined {
  if (submitted.phase !== current.phase) return "phase-mismatch";
  if (submitted.gateId !== current.gateId || submitted.gateNonce !== current.gateNonce) return "stale-gate";
  if (submitted.artifactRefs.length !== current.artifactRefs.length) return "artifact-mismatch";
  for (const [index, artifact] of submitted.artifactRefs.entries()) {
    const expected = current.artifactRefs[index];
    if (artifact.kind !== expected.kind || artifact.version !== expected.version || artifact.path !== expected.path) return "artifact-mismatch";
    if (artifact.checksum !== expected.checksum) return "checksum-mismatch";
  }
  return undefined;
}

function decisionAllowedForPendingGate(decision: RuntimeUserDecision, pending: UserDecisionRequest): boolean {
  if (pending.type === "review-decision") return decision.type === "review-mode" && pending.choices.includes(decision.mode);
  if (decision.type === "approval") return pending.choices.includes(decision.action);
  if (decision.type === "accept-incomplete-design-review") return pending.gate === "design" && decision.confirmed;
  if (decision.type === "retry-design-reviewers") return pending.gate === "design" && decision.reviewerRoles.length > 0;
  if (decision.type === "authorize-design-revision") return pending.gate === "design" && decision.confirmed;
  return false;
}

function detectIdempotentAcceptedDecision(state: WorkflowState, input: SubmitWorkflowDecisionInput): boolean {
  const metadata = acceptedMetadataForInput(state, input);
  return metadata?.idempotencyKey === input.idempotency.key && metadata.decisionSource === input.source;
}

function detectConsumedGate(state: WorkflowState, input: SubmitWorkflowDecisionInput): boolean {
  const metadata = acceptedMetadataForInput(state, input);
  return Boolean(metadata?.idempotencyKey && metadata.idempotencyKey !== input.idempotency.key);
}

function acceptedMetadataForInput(state: WorkflowState, input: SubmitWorkflowDecisionInput): DurableDecisionIdempotencyMetadata | undefined {
  if (input.binding.gateId === "design-review-decision") return state.reviewDecisions.design;
  if (input.binding.gateId === "design-approval") return state.gates.design;
  if (input.binding.gateId === "plan-approval") return state.gates.plan;
  return undefined;
}

function messageForRejection(reason: WorkflowDecisionRejectionReason): string {
  if (reason === "phase-mismatch") return "Submitted decision phase does not match current workflow phase.";
  if (reason === "stale-gate") return "Submitted gate nonce does not match the current pending gate.";
  if (reason === "artifact-mismatch") return "Submitted artifact references do not match the current pending gate.";
  if (reason === "checksum-mismatch") return "Submitted artifact checksum does not match the current pending gate.";
  return "Submitted workflow decision was rejected.";
}

export function bindingFromPendingGate(binding: PendingGateBinding): WorkflowDecisionBinding {
  return {
    gateId: binding.gateId,
    gateNonce: binding.gateNonce,
    phase: binding.phase,
    artifactRefs: binding.artifactRefs,
  };
}
