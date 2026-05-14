import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validateClarificationTopicSlug } from "../topic-validation.ts";
import { createWorkflowLayout, writeVersionedArtifact } from "./artifact-store.ts";
import { appendWorkflowEvent } from "./events.ts";
import { transition, type TransitionContext } from "./state-machine.ts";
import { defaultWorkflowAdapters } from "./adapters/registry.ts";
import { isAdapterPhaseResult, type AdapterPhaseResult } from "./adapters/types.ts";
import type { ApprovalRef, PendingGateBinding, ReviewDecisionRef, ReviewMode, ReviewPhaseStatus, UserDecisionRequest, VersionedArtifactRef, WorkflowErrorSnapshot, WorkflowPhase, WorkflowState } from "./types.ts";
import type { DesignReviewPanelResult } from "./adapters/design-review/types.ts";
import type { DesignRevisionRecord } from "./adapters/design-revision/types.ts";
import type { WorkflowDecisionSource } from "./decision-facade.ts";
import { artifactDisplayRefFromVersionedArtifact, createEmptyWorkflowReviewPanelSummary, type WorkflowReviewPanelSummary } from "./review-panel-summary.ts";
import { createEmptyWorkflowExecutionSummary, type WorkflowExecutionSummary } from "./execution-summary.ts";

export type WorkflowBootstrapInput = {
  cwd: string;
  topic: string;
  request: string;
  now?: Date;
  runId?: string;
};

export type WorkflowAugmentInput = {
  cwd: string;
  topic: string;
  request: string;
  now?: Date;
  runId?: string;
};

export type WorkflowRuntimePaths = {
  specsRoot: string;
  topicDir: string;
  workflowDir: string;
  statePath: string;
};

export type WorkflowRuntimeStatus = {
  topic: string;
  runId: string;
  phase: WorkflowPhase;
  pendingDecision?: UserDecisionRequest;
  artifacts: WorkflowState["artifacts"];
  reviewStatus: WorkflowState["reviewStatus"];
  planReviewStatus?: {
    readinessStatus?: string;
    ledgerPath?: string;
    reviewerStatus?: unknown;
    revisionAttemptStatus?: string;
    postRevisionReviewStatus?: string;
    nextAction: string;
  };
  lastError?: WorkflowErrorSnapshot;
  revisionHandoff?: ReviewPhaseStatus["revisionHandoff"];
  reviewPanelSummary?: WorkflowReviewPanelSummary;
  executionSummary?: WorkflowExecutionSummary;
};

export type ResumeWorkflowInput = {
  cwd: string;
  topic?: string;
  decision?: RuntimeUserDecision;
};

export type RuntimeUserDecision =
  | { type: "review-mode"; mode: ReviewMode; user: string }
  | { type: "approval"; action: "approve" | "revise" | "status" | "exit"; user: string }
  | { type: "retry-design-reviewers"; user: string; reviewRunId?: string; reviewerRoles: string[] }
  | { type: "accept-incomplete-design-review"; user: string; confirmed: boolean; reviewRunId?: string; coverageChecksum?: string }
  | { type: "authorize-design-revision"; user: string; confirmed: boolean; reviewRunId?: string };

// Optional tool-facing input intentionally mirrors the public command boundary:
// start, augment, resume, or status only. Tool integrations may carry a
// RuntimeUserDecision on resume, but runtime code remains the only authority
// for artifact binding, review/retry/accept-incomplete, approval gates, and
// lifecycle transitions. Do not add generic subagent orchestration, arbitrary
// chains, or background async runner behavior to this boundary.
export type BrainstormingProToolInput =
  | { action: "start"; cwd: string; topic: string; request: string }
  | { action: "augment"; cwd: string; topic: string; request: string }
  | { action: "resume"; cwd: string; topic?: string; decision?: RuntimeUserDecision }
  | { action: "status"; cwd: string; topic?: string };

export type BrainstormingProToolResult = Awaited<ReturnType<typeof startWorkflow>> | Awaited<ReturnType<typeof resumeWorkflow>> | Awaited<ReturnType<typeof getStatus>>;

export type WorkflowAdapter = {
  run(state: WorkflowState): Promise<Partial<WorkflowState> | AdapterPhaseResult | void> | Partial<WorkflowState> | AdapterPhaseResult | void;
};

export type WorkflowRuntimeOptions = {
  adapters?: Partial<Record<WorkflowPhase, WorkflowAdapter>>;
  useDefaultAdapters?: boolean;
};

export function createWorkflowRunId(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `run-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${randomUUID().slice(0, 8)}`;
}

export function getWorkflowRuntimePaths(cwd: string, topic: string, runId: string): WorkflowRuntimePaths {
  validateClarificationTopicSlug(topic);
  if (!runId.trim() || path.isAbsolute(runId) || runId.includes("..") || runId.includes("/") || runId.includes("\\")) {
    throw new Error("Workflow run id must be a safe path segment.");
  }
  const specsRoot = path.resolve(cwd, "specs");
  const topicDir = path.resolve(specsRoot, topic);
  const workflowDir = path.resolve(topicDir, ".workflow", "runs", runId);
  const statePath = path.resolve(workflowDir, "state.json");
  assertInside(topicDir, specsRoot);
  assertInside(workflowDir, topicDir);
  assertInside(statePath, topicDir);
  return { specsRoot, topicDir, workflowDir, statePath };
}

export function createInitialWorkflowState(input: Omit<WorkflowBootstrapInput, "cwd"> & { runId?: string }): WorkflowState {
  validateClarificationTopicSlug(input.topic);
  if (!input.request.trim()) throw new Error("Workflow request cannot be empty.");
  const now = (input.now ?? new Date()).toISOString();
  return {
    version: 1,
    runId: input.runId ?? createWorkflowRunId(input.now),
    topic: input.topic,
    request: input.request,
    phase: "designing",
    createdAt: now,
    updatedAt: now,
    artifacts: {},
    reviewDecisions: {},
    reviewStatus: {},
    gates: {},
  };
}

export async function startWorkflow(input: WorkflowBootstrapInput): Promise<{ state: WorkflowState; paths: WorkflowRuntimePaths }> {
  const state = createInitialWorkflowState(input);
  const paths = getWorkflowRuntimePaths(input.cwd, state.topic, state.runId);
  await fs.mkdir(paths.workflowDir, { recursive: true });
  await fs.writeFile(paths.statePath, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx" });
  return { state, paths };
}

export async function augmentWorkflow(input: WorkflowAugmentInput): Promise<{ state: WorkflowState; paths: WorkflowRuntimePaths }> {
  validateClarificationTopicSlug(input.topic);
  if (!input.request.trim()) throw new Error("Workflow request cannot be empty.");
  const previous = await loadLatestWorkflowState(input.cwd, input.topic);
  const now = (input.now ?? new Date()).toISOString();
  const state: WorkflowState = {
    ...previous,
    runId: input.runId ?? createWorkflowRunId(input.now),
    request: input.request,
    supplementalRequests: [...(previous.supplementalRequests ?? []), { request: input.request, receivedAt: now }],
    contextDesignPath: previous.artifacts.design?.path ?? "design.md",
    phase: "designing",
    createdAt: now,
    updatedAt: now,
    reviewDecisions: {},
    reviewStatus: {},
    gates: {},
    pendingDecision: undefined,
    lastError: undefined,
  };
  const paths = getWorkflowRuntimePaths(input.cwd, state.topic, state.runId);
  await fs.mkdir(paths.workflowDir, { recursive: true });
  await fs.writeFile(paths.statePath, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx" });
  return { state, paths };
}

export class WorkflowRuntimeOrchestrator {
  private readonly cwd: string;
  private readonly adapters: Partial<Record<WorkflowPhase, WorkflowAdapter>>;

  constructor(cwd: string, options: WorkflowRuntimeOptions = {}) {
    this.cwd = cwd;
    this.adapters = options.useDefaultAdapters ? { ...defaultWorkflowAdapters(cwd), ...(options.adapters ?? {}) } : (options.adapters ?? {});
  }

  async startWorkflow(topic: string, request: string): Promise<WorkflowState> {
    const { state } = await startWorkflow({ cwd: this.cwd, topic, request });
    return this.runActivePhase(state);
  }

  async augmentWorkflow(topic: string, request: string): Promise<WorkflowState> {
    const { state } = await augmentWorkflow({ cwd: this.cwd, topic, request });
    return this.runActivePhase(state);
  }

  async resumeWorkflow(topic?: string, decision?: RuntimeUserDecision): Promise<WorkflowState | { selectionRequired: string[] }> {
    const selected = topic ?? await this.singlePendingTopic();
    if (!selected) return { selectionRequired: await discoverWorkflowTopics(this.cwd) };
    let state = await loadLatestWorkflowState(this.cwd, selected);
    if (state.phase === "done") return state;
    if (state.phase === "blocked" || state.phase === "failed") return state;
    if (decision) state = await saveWorkflowState(this.cwd, applyRuntimeUserDecision(state, decision));
    if (isDecisionPhase(state.phase)) return saveWorkflowState(this.cwd, withPendingDecision(state));
    return this.runActivePhase(state);
  }

  async getStatus(topic?: string): Promise<WorkflowRuntimeStatus | { selectionRequired: string[] }> {
    const selected = topic ?? await this.singlePendingTopic();
    if (!selected) return { selectionRequired: await discoverWorkflowTopics(this.cwd) };
    const state = await loadLatestWorkflowState(this.cwd, selected);
    return renderWorkflowStatus(withPendingDecision(state));
  }

  private async runActivePhase(state: WorkflowState): Promise<WorkflowState> {
    const adapter = this.adapters[state.phase];
    if (!adapter) return saveWorkflowState(this.cwd, withPendingDecision(state));
    try {
      const result = await adapter.run(state);
      const next = await this.applyAdapterResult(state, result);
      return saveWorkflowState(this.cwd, withPendingDecision(next));
    } catch (error) {
      return saveWorkflowState(this.cwd, { ...state, phase: "blocked", lastError: { message: error instanceof Error ? error.message : String(error), phase: state.phase, recoverable: true, occurredAt: new Date().toISOString() }, updatedAt: new Date().toISOString() });
    }
  }

  private async applyAdapterResult(state: WorkflowState, result: Partial<WorkflowState> | AdapterPhaseResult | void): Promise<WorkflowState> {
    if (!result) return { ...state, updatedAt: new Date().toISOString() };
    if (!isAdapterPhaseResult(result)) return { ...state, ...result, updatedAt: new Date().toISOString() };

    if (result.kind === "artifact-commit-request") {
      const layout = await createWorkflowLayout(this.cwd, state.topic);
      const committed: Partial<WorkflowState["artifacts"]> = {};
      for (const artifact of result.artifacts) {
        const ref = await writeVersionedArtifact(layout, artifact.kind, artifact.content);
        committed[artifact.kind] = ref;
        await appendWorkflowEvent(layout, { type: "artifact.created", phase: state.phase, details: { artifact: ref, summary: artifact.summary } });
      }
      const artifacts = { ...state.artifacts, ...committed };
      const phase = phaseAfterArtifactCommit(state.phase);
      await appendWorkflowEvent(layout, { type: "phase.completed", phase: state.phase, details: { nextPhase: phase, artifacts: Object.values(committed), metadata: result.metadata } });
      return { ...state, phase, artifacts, updatedAt: new Date().toISOString() };
    }

    if (result.kind === "blocked") {
      const layout = await createWorkflowLayout(this.cwd, state.topic);
      await appendWorkflowEvent(layout, { type: "phase.blocked", phase: state.phase, details: { reason: result.reason, diagnostics: result.diagnostics } });
      return {
        ...state,
        phase: "blocked",
        lastError: {
          message: result.reason,
          phase: state.phase,
          recoverable: true,
          occurredAt: new Date().toISOString(),
          details: result.diagnostics,
        },
        updatedAt: new Date().toISOString(),
      };
    }

    const layout = await createWorkflowLayout(this.cwd, state.topic);
    await appendWorkflowEvent(layout, { type: "phase.failed", phase: state.phase, details: { error: result.error } });
    return {
      ...state,
      phase: result.error.retryable ? "blocked" : "failed",
      lastError: {
        message: result.error.message,
        phase: state.phase,
        recoverable: result.error.retryable,
        occurredAt: new Date().toISOString(),
        details: { kind: result.error.kind, details: result.error.details },
      },
      updatedAt: new Date().toISOString(),
    };
  }

  private async singlePendingTopic(): Promise<string | undefined> {
    const topics = await discoverWorkflowTopics(this.cwd);
    return topics.length === 1 ? topics[0] : undefined;
  }
}

export async function resumeWorkflow(input: ResumeWorkflowInput): Promise<WorkflowState | { selectionRequired: string[] }> {
  return new WorkflowRuntimeOrchestrator(input.cwd, { useDefaultAdapters: true }).resumeWorkflow(input.topic, input.decision);
}

export async function getStatus(cwd: string, topic?: string): Promise<WorkflowRuntimeStatus | { selectionRequired: string[] }> {
  return new WorkflowRuntimeOrchestrator(cwd, { useDefaultAdapters: true }).getStatus(topic);
}

export async function invokeBrainstormingProRuntime(input: BrainstormingProToolInput): Promise<BrainstormingProToolResult> {
  if (input.action === "start") return startWorkflow({ cwd: input.cwd, topic: input.topic, request: input.request });
  if (input.action === "augment") return augmentWorkflow({ cwd: input.cwd, topic: input.topic, request: input.request });
  if (input.action === "resume") return resumeWorkflow({ cwd: input.cwd, topic: input.topic, decision: input.decision });
  return getStatus(input.cwd, input.topic);
}

export async function loadLatestWorkflowState(cwd: string, topic: string): Promise<WorkflowState> {
  const runId = await latestRunId(cwd, topic);
  if (!runId) throw new Error(`No workflow run found for ${topic}.`);
  const paths = getWorkflowRuntimePaths(cwd, topic, runId);
  const parsed = JSON.parse(await fs.readFile(paths.statePath, "utf8")) as WorkflowState;
  return parsed;
}

export async function saveWorkflowState(cwd: string, state: WorkflowState): Promise<WorkflowState> {
  const paths = getWorkflowRuntimePaths(cwd, state.topic, state.runId);
  await fs.mkdir(paths.workflowDir, { recursive: true });
  await fs.writeFile(paths.statePath, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

export async function discoverWorkflowTopics(cwd: string): Promise<string[]> {
  const specsRoot = path.resolve(cwd, "specs");
  try {
    const entries = await fs.readdir(specsRoot, { withFileTypes: true });
    const topics: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        validateClarificationTopicSlug(entry.name);
        if (await latestRunId(cwd, entry.name)) topics.push(entry.name);
      } catch {
        // Ignore unsafe or non-runtime spec directories during discovery.
      }
    }
    return topics.sort();
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

export type ApplyRuntimeUserDecisionOptions = {
  idempotencyKey?: string;
  decisionSource?: WorkflowDecisionSource;
};

export function applyRuntimeUserDecision(state: WorkflowState, decision: RuntimeUserDecision, options: ApplyRuntimeUserDecisionOptions = {}): WorkflowState {
  if (decision.type === "review-mode") {
    if (state.phase !== "awaiting-design-review-decision") return state;
    const target = reviewTargetForPhase(state.phase);
    const reviewDecision: ReviewDecisionRef = {
      id: `${target}-${Date.now()}`,
      target,
      mode: decision.mode,
      artifacts: artifactsForDecision(state),
      selectedBy: decision.user,
      selectedAt: new Date().toISOString(),
      path: `.workflow/decisions/${target}.json`,
      idempotencyKey: options.idempotencyKey,
      decisionSource: options.decisionSource,
    };
    const to = decision.mode === "skip" ? "awaiting-design-approval" : "design-review";
    return { ...state, phase: transition(state.phase, to, { reviewMode: decision.mode } satisfies TransitionContext), reviewDecisions: { ...state.reviewDecisions, [target]: reviewDecision }, reviewStatus: decision.mode === "skip" ? { ...state.reviewStatus, [target]: { target, mode: "skip", status: "skipped", artifacts: artifactsForDecision(state), reason: "user-selected-skip", completedAt: new Date().toISOString() } } : state.reviewStatus, pendingDecision: undefined, updatedAt: new Date().toISOString() };
  }

  if (decision.type === "approval" && decision.action === "approve") {
    if (state.phase !== "awaiting-design-approval" && state.phase !== "awaiting-plan-approval") return state;
    const gate = state.phase === "awaiting-design-approval" ? "design" : "plan";
    if (gate === "plan") assertPlanApprovalMatchesReadyReview(state);
    const approval: ApprovalRef = { gate, artifacts: artifactsForDecision(state), approvedBy: decision.user, approvedAt: new Date().toISOString(), path: `.workflow/approvals/${gate}-approval.json`, idempotencyKey: options.idempotencyKey, decisionSource: options.decisionSource };
    const to = gate === "design" ? "planning" : "executing";
    return { ...state, phase: transition(state.phase, to), gates: { ...state.gates, [gate]: approval }, pendingDecision: undefined, updatedAt: new Date().toISOString() };
  }

  if (decision.type === "approval" && decision.action === "revise") {
    if (state.phase === "awaiting-design-approval") return { ...state, phase: "designing", pendingDecision: undefined, updatedAt: new Date().toISOString() };
    if (state.phase === "awaiting-plan-approval") return { ...state, phase: "planning", pendingDecision: undefined, updatedAt: new Date().toISOString() };
  }
  return state;
}

export function renderWorkflowStatus(state: WorkflowState): WorkflowRuntimeStatus {
  const planReview = state.reviewStatus.plan?.planReview;
  return {
    topic: state.topic,
    runId: state.runId,
    phase: state.phase,
    pendingDecision: state.pendingDecision,
    artifacts: state.artifacts,
    reviewStatus: state.reviewStatus,
    ...(planReview ? { planReviewStatus: { readinessStatus: planReview.readinessStatus, ledgerPath: planReview.ledgerPath, reviewerStatus: state.reviewStatus.plan?.coverage, revisionAttemptStatus: planReview.revisionAttempted ? "attempted" : "not-attempted", postRevisionReviewStatus: state.reviewStatus.plan?.revisionHandoff?.postRevisionReviewRunId, nextAction: planReview.readinessStatus === "ready-for-plan-approval" ? "approve-plan" : "inspect-plan-review-diagnostics" } } : {}),
    lastError: state.lastError,
    revisionHandoff: state.reviewStatus.design?.revisionHandoff,
    reviewPanelSummary: buildWorkflowReviewPanelSummary(state),
    executionSummary: buildWorkflowExecutionSummary(state),
  };
}

function buildWorkflowExecutionSummary(state: WorkflowState): WorkflowExecutionSummary {
  const isExecutionState = state.phase === "executing" || state.phase === "done" || state.phase === "blocked" || state.phase === "failed";
  return createEmptyWorkflowExecutionSummary({
    topic: state.topic,
    runId: state.runId,
    generatedAt: new Date().toISOString(),
    status: state.phase === "done" ? "completed" : state.phase === "blocked" ? "blocked" : state.phase === "failed" ? "failed" : state.phase === "executing" ? "running" : "not-started",
    diagnostics: isExecutionState ? [] : [{ level: "info", code: "execution-summary-empty", message: "No controlled execution detail is available for the current workflow state." }],
  });
}

function buildWorkflowReviewPanelSummary(state: WorkflowState): WorkflowReviewPanelSummary {
  const summary = createEmptyWorkflowReviewPanelSummary({ topic: state.topic, runId: state.runId, generatedAt: new Date().toISOString(), diagnostics: [] });
  const design = state.reviewStatus.design;
  if (design) {
    summary.designReview = {
      mode: design.mode,
      status: design.status,
      designRef: design.artifacts[0] ? artifactDisplayRefFromVersionedArtifact(design.artifacts[0]) : undefined,
      coverage: [],
      readiness: design.readinessStatus ? { status: design.readinessStatus } : undefined,
      partial: design.status === "partial",
      incomplete: design.status === "partial" || design.reason === "incomplete-design-review",
      stale: design.status === "unavailable" && design.reason?.includes("stale"),
      diagnostics: design.reason ? [{ level: "warning", code: "design-review-reason", message: design.reason }] : [],
    };
  } else {
    summary.diagnostics.push({ level: "info", code: "design-review-unavailable", message: "Design review summary is unavailable for the current workflow state." });
  }
  const revision = state.reviewStatus.design?.revisionHandoff;
  if (revision) {
    summary.designRevision = {
      currentDesignRef: state.artifacts.design ? artifactDisplayRefFromVersionedArtifact(state.artifacts.design) : undefined,
      latestRevision: {
        revisionId: revision.revisionId,
        revisedDesignRef: artifactDisplayRefFromVersionedArtifact(revision.revisedDesignRef),
        status: "committed",
        postRevisionReviewRunId: revision.postRevisionReviewRunId,
      },
    };
  }
  const plan = state.reviewStatus.plan;
  if (plan?.planReview) {
    const reviewed = plan.planReview.reviewedArtifacts;
    summary.planReview = {
      reviewRunId: plan.planReview.reviewRunId,
      status: plan.status,
      approvedDesignRef: reviewed.find((artifact) => artifact.kind === "design") ? artifactDisplayRefFromVersionedArtifact(reviewed.find((artifact) => artifact.kind === "design")!) : undefined,
      requirementsRef: reviewed.find((artifact) => artifact.kind === "requirements") ? artifactDisplayRefFromVersionedArtifact(reviewed.find((artifact) => artifact.kind === "requirements")!) : undefined,
      tasksRef: reviewed.find((artifact) => artifact.kind === "tasks") ? artifactDisplayRefFromVersionedArtifact(reviewed.find((artifact) => artifact.kind === "tasks")!) : undefined,
      readiness: { status: plan.planReview.readinessStatus },
      reviewers: [],
      ledgerLinks: [{ label: "plan review ledger", path: plan.planReview.ledgerPath }],
      automaticRevision: { attemptNumber: plan.planReview.revisionAttempted ? 1 : 0, maxAttempts: 1, status: plan.planReview.revisionAttempted ? "committed" : "not-needed" },
    };
  }
  return summary;
}

export function applyPostRevisionReviewResultToState(state: WorkflowState, result: DesignReviewPanelResult, record: DesignRevisionRecord): WorkflowState {
  if (!record.targetDesignRef) throw new Error("Post-revision review handoff requires a revised design ref.");
  const revisionHandoff = {
    revisionId: record.revisionId,
    revisedDesignRef: record.targetDesignRef,
    postRevisionReviewRunId: result.reviewRunId,
  };
  const recoveryActions = [
    ...((state.reviewStatus.design?.recoveryActions as unknown[] | undefined) ?? []),
    { type: "post-revision-handoff", revisionId: record.revisionId, revisedDesignRef: record.targetDesignRef, postRevisionReviewRunId: result.reviewRunId, readinessStatus: result.enhancedReadiness?.status ?? result.readiness.status, triageSummary: result.triageSummary },
  ];
  const reviewStatus: ReviewPhaseStatus = {
    target: "design",
    mode: result.mode,
    status: result.status,
    artifacts: [record.targetDesignRef],
    readinessStatus: result.enhancedReadiness?.status ?? result.readiness.status,
    enhancedReadiness: result.enhancedReadiness,
    triageSummary: result.triageSummary,
    triage: result.triage ? { mustFix: result.triage.clusters.filter((cluster) => cluster.triageLevel === "must-fix").length, shouldFix: result.triage.clusters.filter((cluster) => cluster.triageLevel === "should-fix").length, notes: result.triage.clusters.filter((cluster) => cluster.triageLevel === "note").length, conflicts: result.triage.conflicts.length, unresolvedQuestions: result.triage.unresolvedQuestions.length } : undefined,
    coverage: result.aggregate?.coverage,
    recoveryActions,
    revisionHandoff,
    ...(result.status === "failed" && result.error ? { reason: result.error.message } : {}),
    ...(result.status === "partial" ? { reason: "incomplete-design-review" } : {}),
    ...(result.status === "unavailable" ? { reason: result.unavailableReason } : {}),
    completedAt: new Date().toISOString(),
  };
  const phase: WorkflowPhase = result.status === "passed" ? "awaiting-design-approval" : "blocked";
  return {
    ...state,
    phase,
    artifacts: { ...state.artifacts, design: record.targetDesignRef },
    reviewStatus: { ...state.reviewStatus, design: reviewStatus },
    pendingDecision: undefined,
    ...(phase === "blocked" ? { lastError: { message: "post-revision-review-requires-user-decision", phase: "design-review" as const, recoverable: true, occurredAt: new Date().toISOString(), details: { recoveryActions, revisionHandoff } } } : { lastError: undefined }),
    updatedAt: new Date().toISOString(),
  };
}

function withPendingDecision(state: WorkflowState): WorkflowState {
  if (state.phase === "awaiting-design-review-decision") {
    const artifacts = artifactsForDecision(state);
    const pendingDecision: UserDecisionRequest = { type: "review-decision", target: "design", artifacts, choices: ["skip", "minimal", "full", "revise", "exit"] };
    return { ...state, pendingDecision: withGateBinding(state, pendingDecision, artifacts) };
  }
  if (state.phase === "awaiting-design-approval") {
    const artifacts = artifactsForDecision(state);
    const pendingDecision: UserDecisionRequest = { type: "approval", gate: "design", artifacts, choices: ["approve", "revise", "status", "exit"] };
    return { ...state, pendingDecision: withGateBinding(state, pendingDecision, artifacts) };
  }
  if (state.phase === "awaiting-plan-approval") {
    const artifacts = artifactsForDecision(state);
    const pendingDecision: UserDecisionRequest = { type: "approval", gate: "plan", artifacts, choices: ["approve", "revise", "status", "exit"] };
    return { ...state, pendingDecision: withGateBinding(state, pendingDecision, artifacts) };
  }
  return { ...state, pendingDecision: undefined };
}

function withGateBinding(state: WorkflowState, pendingDecision: UserDecisionRequest, artifacts: VersionedArtifactRef[]): UserDecisionRequest {
  const existing = state.pendingDecision?.binding;
  if (existing && existing.gateId === gateIdForPendingDecision(pendingDecision) && existing.phase === state.phase && artifactRefsMatch(existing.artifactRefs, artifacts)) {
    return { ...pendingDecision, binding: existing };
  }
  return { ...pendingDecision, binding: createPendingGateBinding(state.phase, gateIdForPendingDecision(pendingDecision), artifacts) };
}

function createPendingGateBinding(phase: WorkflowPhase, gateId: string, artifacts: VersionedArtifactRef[]): PendingGateBinding {
  return {
    gateId,
    gateNonce: randomUUID(),
    phase,
    artifactRefs: artifacts,
    createdAt: new Date().toISOString(),
  };
}

function gateIdForPendingDecision(pendingDecision: UserDecisionRequest): string {
  if (pendingDecision.type === "review-decision") return `${pendingDecision.target}-review-decision`;
  return `${pendingDecision.gate}-approval`;
}

function artifactRefsMatch(left: VersionedArtifactRef[], right: VersionedArtifactRef[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((artifact, index) => {
    const candidate = right[index];
    return artifact.kind === candidate.kind && artifact.version === candidate.version && artifact.path === candidate.path && artifact.checksum === candidate.checksum;
  });
}

function artifactsForDecision(state: WorkflowState): VersionedArtifactRef[] {
  if (state.phase.includes("design")) return state.artifacts.design ? [state.artifacts.design] : [];
  return [state.artifacts.requirements, state.artifacts.tasks].filter((artifact): artifact is VersionedArtifactRef => Boolean(artifact));
}

function reviewTargetForPhase(phase: WorkflowPhase): "design" | "plan" {
  return phase === "awaiting-design-review-decision" ? "design" : "plan";
}

function assertPlanApprovalMatchesReadyReview(state: WorkflowState): void {
  const planReview = state.reviewStatus.plan?.planReview;
  if (!planReview || planReview.readinessStatus !== "ready-for-plan-approval") throw new Error("Plan approval requires a ready automatic plan review for the current artifacts.");
  const current = [state.artifacts.requirements, state.artifacts.tasks].filter((artifact): artifact is VersionedArtifactRef => Boolean(artifact));
  if (current.length !== 2) throw new Error("Plan approval requires current requirements and tasks artifacts.");
  for (const artifact of current) {
    const reviewed = planReview.reviewedArtifacts.find((candidate) => candidate.kind === artifact.kind);
    if (!reviewed || reviewed.version !== artifact.version || reviewed.path !== artifact.path || reviewed.checksum !== artifact.checksum) {
      throw new Error("Plan approval artifacts do not match the latest ready plan review binding.");
    }
  }
}

function phaseAfterArtifactCommit(phase: WorkflowPhase): WorkflowPhase {
  if (phase === "designing") return transition(phase, "awaiting-design-review-decision");
  if (phase === "planning") return transition(phase, "plan-review");
  return phase;
}

function isDecisionPhase(phase: WorkflowPhase): boolean {
  return phase === "awaiting-design-review-decision" || phase === "awaiting-design-approval" || phase === "awaiting-plan-approval";
}

async function latestRunId(cwd: string, topic: string): Promise<string | undefined> {
  validateClarificationTopicSlug(topic);
  const runsDir = path.resolve(cwd, "specs", topic, ".workflow", "runs");
  try {
    const entries = await fs.readdir(runsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().at(-1);
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function assertInside(targetPath: string, rootPath: string): void {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new Error(`Unsafe workflow path outside topic directory: ${target}`);
}
