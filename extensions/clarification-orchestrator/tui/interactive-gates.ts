import type { RuntimeUserDecision } from "../workflow/runtime.ts";
import type { GateCardSnapshot, WorkflowLiveSnapshot } from "../workflow/progress-types.ts";
import type { FullDesignReviewerRole, PendingGateBinding, VersionedArtifactRef, WorkflowPhase } from "../workflow/types.ts";
import type { WorkflowDecisionBinding } from "../workflow/decision-facade.ts";

export type InteractiveGateAction =
  | "select-design-review-mode"
  | "approve-design"
  | "revise-design"
  | "retry-design-reviewers"
  | "accept-incomplete-design-review"
  | "authorize-design-revision"
  | "approve-plan"
  | "exit"
  | "status";

export type InteractiveArtifactBinding = Pick<VersionedArtifactRef, "kind" | "version" | "path" | "checksum">;

export type BaseInteractiveGateModel = {
  kind: string;
  enabled: boolean;
  gateId?: string;
  phase: WorkflowPhase;
  binding?: WorkflowDecisionBinding;
  artifacts: InteractiveArtifactBinding[];
  availableActions: InteractiveGateAction[];
  warnings: string[];
  cliFallback: string;
};

export type DesignReviewModeGateModel = BaseInteractiveGateModel & {
  kind: "design-review-mode";
  designRef?: InteractiveArtifactBinding;
  choices: Array<"skip" | "minimal" | "full" | "revise" | "exit">;
};

export type DesignApprovalGateModel = BaseInteractiveGateModel & {
  kind: "design-approval";
  designRef?: InteractiveArtifactBinding;
  readinessStatus?: string;
  triageSummary?: string;
};

export type DesignReviewRecoveryGateModel = BaseInteractiveGateModel & {
  kind: "design-review-recovery";
  reviewRunId?: string;
  selectedReviewers: string[];
  succeededReviewers: string[];
  failedReviewers: string[];
  diagnosticsSummary?: string;
};

export type AcceptIncompleteGateModel = BaseInteractiveGateModel & {
  kind: "accept-incomplete-design-review";
  reviewRunId?: string;
  blockingFindingCount?: number;
  coverageChecksum?: string;
};

export type DesignRevisionAuthorizationGateModel = BaseInteractiveGateModel & {
  kind: "design-revision-authorization";
  sourceDesignRef?: InteractiveArtifactBinding;
  sourceReviewRunId?: string;
  postRevisionReviewMode?: "minimal" | "full";
  postRevisionReviewerRoles?: FullDesignReviewerRole[];
};

export type PlanApprovalGateModel = BaseInteractiveGateModel & {
  kind: "plan-approval";
  approvedDesignRef?: InteractiveArtifactBinding;
  requirementsRef?: InteractiveArtifactBinding;
  tasksRef?: InteractiveArtifactBinding;
  planReviewRunId?: string;
  readinessStatus?: string;
};

export type NoInteractiveGateModel = BaseInteractiveGateModel & {
  kind: "no-gate" | "non-interactive";
  reason: string;
};

export type InteractiveGateModel =
  | DesignReviewModeGateModel
  | DesignApprovalGateModel
  | DesignReviewRecoveryGateModel
  | AcceptIncompleteGateModel
  | DesignRevisionAuthorizationGateModel
  | PlanApprovalGateModel
  | NoInteractiveGateModel;

export type DecisionPayload = {
  decision: RuntimeUserDecision;
  binding: WorkflowDecisionBinding;
};

export function buildInteractiveGateModel(snapshot: WorkflowLiveSnapshot): InteractiveGateModel {
  const cliFallback = fallbackForSnapshot(snapshot);
  if (snapshot.stale) return noGate(snapshot, "Snapshot is stale; refresh before submitting a decision.", cliFallback);
  const gate = snapshot.gates.find((candidate) => candidate.status === "awaiting-user");
  if (!gate) return noGate(snapshot, "No pending interactive workflow gate is visible.", cliFallback);
  const binding = bindingFromGate(gate);
  const artifacts = gate.artifacts.map((artifact) => ({ kind: artifact.kind, version: artifact.version, path: artifact.path, checksum: artifact.checksum }));
  const base = baseModel(snapshot, gate, binding, artifacts, cliFallback);
  if (!binding) return { ...base, kind: "non-interactive", reason: "Pending gate is missing runtime binding data.", enabled: false, availableActions: [], warnings: [...base.warnings, "Refresh or use CLI fallback; no decision was submitted."] };

  if (gate.gate === "design-review-decision") {
    return { ...base, kind: "design-review-mode", designRef: artifacts.find((artifact) => artifact.kind === "design"), choices: ["skip", "minimal", "full", "revise", "exit"], availableActions: ["select-design-review-mode", "exit"] };
  }
  if (gate.gate === "design-approval") {
    const recovery = recoveryContext(gate);
    if (recovery?.type === "retry-failed-reviewers") {
      return { ...base, kind: "design-review-recovery", reviewRunId: recovery.reviewRunId, selectedReviewers: recovery.selectedReviewers, succeededReviewers: recovery.succeededReviewers, failedReviewers: recovery.failedReviewers, diagnosticsSummary: recovery.diagnosticsSummary, availableActions: ["retry-design-reviewers", "status", "exit"] };
    }
    if (recovery?.type === "accept-incomplete") {
      return { ...base, kind: "accept-incomplete-design-review", reviewRunId: recovery.reviewRunId, blockingFindingCount: recovery.blockingFindingCount, coverageChecksum: recovery.coverageChecksum, availableActions: ["accept-incomplete-design-review", "status", "exit"], warnings: [...base.warnings, "Incomplete review is not passed review and does not approve design."] };
    }
    if (recovery?.type === "authorize-design-revision") {
      return { ...base, kind: "design-revision-authorization", sourceDesignRef: artifacts.find((artifact) => artifact.kind === "design"), sourceReviewRunId: recovery.reviewRunId, postRevisionReviewMode: recovery.postRevisionReviewMode, postRevisionReviewerRoles: recovery.postRevisionReviewerRoles, availableActions: ["authorize-design-revision", "status", "exit"], warnings: [...base.warnings, "One authorization permits one revision attempt and one post-revision re-review only.", "Authorization does not approve design or allow automatic multi-round revision."] };
    }
    return { ...base, kind: "design-approval", designRef: artifacts.find((artifact) => artifact.kind === "design"), availableActions: ["approve-design", "revise-design", "status", "exit"], warnings: [...base.warnings, "Review readiness is not approval."] };
  }
  if (gate.gate === "plan-approval") {
    return { ...base, kind: "plan-approval", requirementsRef: artifacts.find((artifact) => artifact.kind === "requirements"), tasksRef: artifacts.find((artifact) => artifact.kind === "tasks"), availableActions: ["approve-plan", "status", "exit"], warnings: [...base.warnings, "Plan review ready is not plan approval."] };
  }
  return { ...base, kind: "non-interactive", reason: `Gate ${gate.gate} is not supported by interactive controls.`, enabled: false, availableActions: [], warnings: [...base.warnings, "Use CLI fallback for this gate."] };
}

export function buildReviewModePayload(model: DesignReviewModeGateModel, mode: "skip" | "minimal" | "full", user: string): DecisionPayload {
  return decisionPayload(model, { type: "review-mode", mode, user });
}

export function buildApprovalPayload(model: DesignApprovalGateModel | PlanApprovalGateModel, user: string): DecisionPayload {
  return decisionPayload(model, { type: "approval", action: "approve", user });
}

export function buildRevisePayload(model: DesignApprovalGateModel | PlanApprovalGateModel, user: string): DecisionPayload {
  return decisionPayload(model, { type: "approval", action: "revise", user });
}

export function buildRetryDesignReviewersPayload(model: DesignReviewRecoveryGateModel, user: string): DecisionPayload {
  return decisionPayload(model, { type: "retry-design-reviewers", user, reviewRunId: model.reviewRunId, reviewerRoles: model.failedReviewers });
}

export function buildAcceptIncompletePayload(model: AcceptIncompleteGateModel, user: string, confirmed: boolean): DecisionPayload {
  return decisionPayload(model, { type: "accept-incomplete-design-review", user, confirmed, reviewRunId: model.reviewRunId, coverageChecksum: model.coverageChecksum });
}

export function buildDesignRevisionAuthorizationPayload(model: DesignRevisionAuthorizationGateModel, user: string, confirmed: boolean): DecisionPayload {
  return decisionPayload(model, { type: "authorize-design-revision", user, confirmed, reviewRunId: model.sourceReviewRunId });
}

function decisionPayload(model: InteractiveGateModel, decision: RuntimeUserDecision): DecisionPayload {
  if (!model.binding) throw new Error("Interactive gate model is missing binding.");
  return { decision, binding: model.binding };
}

function noGate(snapshot: WorkflowLiveSnapshot, reason: string, cliFallback: string): NoInteractiveGateModel {
  return { kind: "no-gate", reason, enabled: false, phase: snapshot.phase, artifacts: [], availableActions: [], warnings: [reason], cliFallback };
}

function baseModel(snapshot: WorkflowLiveSnapshot, gate: GateCardSnapshot, binding: WorkflowDecisionBinding | undefined, artifacts: InteractiveArtifactBinding[], cliFallback: string): BaseInteractiveGateModel {
  return {
    kind: "base",
    enabled: Boolean(binding) && !snapshot.stale && !gate.stale,
    gateId: gate.id,
    phase: snapshot.phase,
    binding,
    artifacts,
    availableActions: [],
    warnings: gate.stale || gate.staleReason ? [gate.staleReason ?? "Gate is stale."] : [],
    cliFallback,
  };
}

type RecoveryContext =
  | { type: "retry-failed-reviewers"; reviewRunId?: string; selectedReviewers: string[]; succeededReviewers: string[]; failedReviewers: string[]; diagnosticsSummary?: string }
  | { type: "accept-incomplete"; reviewRunId?: string; blockingFindingCount?: number; coverageChecksum?: string }
  | { type: "authorize-design-revision"; reviewRunId?: string; postRevisionReviewMode?: "minimal" | "full"; postRevisionReviewerRoles?: FullDesignReviewerRole[] };

function recoveryContext(gate: GateCardSnapshot): RecoveryContext | undefined {
  const context = gate.opaqueContext;
  if (!isRecord(context) || !isRecord(context.recovery)) return undefined;
  const recovery = context.recovery;
  if (recovery.type === "retry-failed-reviewers") return { type: "retry-failed-reviewers", reviewRunId: stringValue(recovery.reviewRunId), selectedReviewers: stringArray(recovery.selectedReviewers), succeededReviewers: stringArray(recovery.succeededReviewers), failedReviewers: stringArray(recovery.failedReviewers), diagnosticsSummary: stringValue(recovery.diagnosticsSummary) };
  if (recovery.type === "accept-incomplete") return { type: "accept-incomplete", reviewRunId: stringValue(recovery.reviewRunId), blockingFindingCount: numberValue(recovery.blockingFindingCount), coverageChecksum: stringValue(recovery.coverageChecksum) };
  if (recovery.type === "authorize-design-revision") return { type: "authorize-design-revision", reviewRunId: stringValue(recovery.reviewRunId), postRevisionReviewMode: recovery.postRevisionReviewMode === "minimal" || recovery.postRevisionReviewMode === "full" ? recovery.postRevisionReviewMode : undefined, postRevisionReviewerRoles: stringArray(recovery.postRevisionReviewerRoles).filter(isFullDesignReviewerRole) };
  return undefined;
}

function bindingFromGate(gate: GateCardSnapshot): WorkflowDecisionBinding | undefined {
  const context = gate.opaqueContext;
  if (!isRecord(context) || !isRecord(context.binding)) return undefined;
  const binding = context.binding;
  if (typeof binding.gateId !== "string" || typeof binding.gateNonce !== "string" || typeof binding.phase !== "string" || !Array.isArray(binding.artifactRefs)) return undefined;
  return { gateId: binding.gateId, gateNonce: binding.gateNonce, phase: binding.phase as WorkflowPhase, artifactRefs: binding.artifactRefs.filter(isVersionedArtifactRef) };
}

function isVersionedArtifactRef(value: unknown): value is VersionedArtifactRef {
  if (!isRecord(value)) return false;
  return typeof value.kind === "string" && typeof value.version === "number" && typeof value.path === "string" && typeof value.checksum === "string" && typeof value.createdAt === "string";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function isFullDesignReviewerRole(value: string): value is FullDesignReviewerRole {
  return ["product-reviewer", "architecture-reviewer", "risk-security-reviewer", "testing-reviewer", "scope-simplicity-reviewer"].includes(value);
}

function fallbackForSnapshot(snapshot: WorkflowLiveSnapshot): string {
  return snapshot.fallbackText || `/brainstorm-pro --resume ${snapshot.topic}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
