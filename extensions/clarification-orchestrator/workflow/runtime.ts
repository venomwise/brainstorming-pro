import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validateClarificationTopicSlug } from "../topic-validation.ts";
import { transition, type TransitionContext } from "./state-machine.ts";
import type { ApprovalRef, ReviewDecisionRef, ReviewMode, UserDecisionRequest, VersionedArtifactRef, WorkflowErrorSnapshot, WorkflowPhase, WorkflowState } from "./types.ts";

export type WorkflowBootstrapInput = {
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
  lastError?: WorkflowErrorSnapshot;
};

export type ResumeWorkflowInput = {
  cwd: string;
  topic?: string;
  decision?: RuntimeUserDecision;
};

export type RuntimeUserDecision =
  | { type: "review-mode"; mode: ReviewMode; user: string }
  | { type: "approval"; action: "approve" | "revise" | "status" | "exit"; user: string };

export type BrainstormingProToolInput =
  | { action: "start"; cwd: string; topic: string; request: string }
  | { action: "resume"; cwd: string; topic?: string; decision?: RuntimeUserDecision }
  | { action: "status"; cwd: string; topic?: string };

export type BrainstormingProToolResult = Awaited<ReturnType<typeof startWorkflow>> | Awaited<ReturnType<typeof resumeWorkflow>> | Awaited<ReturnType<typeof getStatus>>;

export type WorkflowAdapter = {
  run(state: WorkflowState): Promise<Partial<WorkflowState> | void> | Partial<WorkflowState> | void;
};

export type WorkflowRuntimeOptions = {
  adapters?: Partial<Record<WorkflowPhase, WorkflowAdapter>>;
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

export class WorkflowRuntimeOrchestrator {
  private readonly cwd: string;
  private readonly adapters: Partial<Record<WorkflowPhase, WorkflowAdapter>>;

  constructor(cwd: string, options: WorkflowRuntimeOptions = {}) {
    this.cwd = cwd;
    this.adapters = options.adapters ?? {};
  }

  async startWorkflow(topic: string, request: string): Promise<WorkflowState> {
    const { state } = await startWorkflow({ cwd: this.cwd, topic, request });
    return this.runActivePhase(state);
  }

  async resumeWorkflow(topic?: string, decision?: RuntimeUserDecision): Promise<WorkflowState | { selectionRequired: string[] }> {
    const selected = topic ?? await this.singlePendingTopic();
    if (!selected) return { selectionRequired: await discoverWorkflowTopics(this.cwd) };
    let state = await loadLatestWorkflowState(this.cwd, selected);
    if (state.phase === "done") return state;
    if (state.phase === "blocked" || state.phase === "failed") return state;
    if (decision) state = await saveWorkflowState(this.cwd, await this.applyDecision(state, decision));
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
      const patch = await adapter.run(state);
      const next = { ...state, ...patch, updatedAt: new Date().toISOString() };
      return saveWorkflowState(this.cwd, withPendingDecision(next));
    } catch (error) {
      return saveWorkflowState(this.cwd, { ...state, phase: "blocked", lastError: { message: error instanceof Error ? error.message : String(error), phase: state.phase, recoverable: true, occurredAt: new Date().toISOString() }, updatedAt: new Date().toISOString() });
    }
  }

  private async applyDecision(state: WorkflowState, decision: RuntimeUserDecision): Promise<WorkflowState> {
    if (decision.type === "review-mode") {
      if (state.phase !== "awaiting-design-review-decision" && state.phase !== "awaiting-plan-review-decision") return state;
      if (decision.mode === "full") return { ...state, reviewStatus: { ...state.reviewStatus, [reviewTargetForPhase(state.phase)]: { target: reviewTargetForPhase(state.phase), mode: "full", status: "unavailable", artifacts: artifactsForDecision(state), reason: "full-review-unavailable", completedAt: new Date().toISOString() } }, updatedAt: new Date().toISOString() };
      const target = reviewTargetForPhase(state.phase);
      const reviewDecision: ReviewDecisionRef = { id: `${target}-${Date.now()}`, target, mode: decision.mode, artifacts: artifactsForDecision(state), selectedBy: decision.user, selectedAt: new Date().toISOString(), path: `.workflow/decisions/${target}.json` };
      const to = state.phase === "awaiting-design-review-decision" ? (decision.mode === "skip" ? "awaiting-design-approval" : "design-review") : (decision.mode === "skip" ? "awaiting-plan-approval" : "plan-review");
      return { ...state, phase: transition(state.phase, to, { reviewMode: decision.mode } satisfies TransitionContext), reviewDecisions: { ...state.reviewDecisions, [target]: reviewDecision }, reviewStatus: decision.mode === "skip" ? { ...state.reviewStatus, [target]: { target, mode: "skip", status: "skipped", artifacts: artifactsForDecision(state), reason: "user-selected-skip", completedAt: new Date().toISOString() } } : state.reviewStatus, pendingDecision: undefined, updatedAt: new Date().toISOString() };
    }

    if (decision.type === "approval" && decision.action === "approve") {
      if (state.phase !== "awaiting-design-approval" && state.phase !== "awaiting-plan-approval") return state;
      const gate = state.phase === "awaiting-design-approval" ? "design" : "plan";
      const approval: ApprovalRef = { gate, artifacts: artifactsForDecision(state), approvedBy: decision.user, approvedAt: new Date().toISOString(), path: `.workflow/approvals/${gate}-approval.json` };
      const to = gate === "design" ? "planning" : "executing";
      return { ...state, phase: transition(state.phase, to), gates: { ...state.gates, [gate]: approval }, pendingDecision: undefined, updatedAt: new Date().toISOString() };
    }

    if (decision.type === "approval" && decision.action === "revise") {
      if (state.phase === "awaiting-design-approval") return { ...state, phase: "designing", pendingDecision: undefined, updatedAt: new Date().toISOString() };
      if (state.phase === "awaiting-plan-approval") return { ...state, phase: "planning", pendingDecision: undefined, updatedAt: new Date().toISOString() };
    }
    return state;
  }

  private async singlePendingTopic(): Promise<string | undefined> {
    const topics = await discoverWorkflowTopics(this.cwd);
    return topics.length === 1 ? topics[0] : undefined;
  }
}

export async function resumeWorkflow(input: ResumeWorkflowInput): Promise<WorkflowState | { selectionRequired: string[] }> {
  return new WorkflowRuntimeOrchestrator(input.cwd).resumeWorkflow(input.topic, input.decision);
}

export async function getStatus(cwd: string, topic?: string): Promise<WorkflowRuntimeStatus | { selectionRequired: string[] }> {
  return new WorkflowRuntimeOrchestrator(cwd).getStatus(topic);
}

export async function invokeBrainstormingProRuntime(input: BrainstormingProToolInput): Promise<BrainstormingProToolResult> {
  if (input.action === "start") return startWorkflow({ cwd: input.cwd, topic: input.topic, request: input.request });
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

export function renderWorkflowStatus(state: WorkflowState): WorkflowRuntimeStatus {
  return { topic: state.topic, runId: state.runId, phase: state.phase, pendingDecision: state.pendingDecision, artifacts: state.artifacts, reviewStatus: state.reviewStatus, lastError: state.lastError };
}

function withPendingDecision(state: WorkflowState): WorkflowState {
  if (state.phase === "awaiting-design-review-decision") return { ...state, pendingDecision: { type: "review-decision", target: "design", artifacts: artifactsForDecision(state), choices: ["skip", "minimal", "full", "revise", "exit"] } };
  if (state.phase === "awaiting-plan-review-decision") return { ...state, pendingDecision: { type: "review-decision", target: "plan", artifacts: artifactsForDecision(state), choices: ["skip", "minimal", "full", "revise", "exit"] } };
  if (state.phase === "awaiting-design-approval") return { ...state, pendingDecision: { type: "approval", gate: "design", artifacts: artifactsForDecision(state), choices: ["approve", "revise", "status", "exit"] } };
  if (state.phase === "awaiting-plan-approval") return { ...state, pendingDecision: { type: "approval", gate: "plan", artifacts: artifactsForDecision(state), choices: ["approve", "revise", "status", "exit"] } };
  return { ...state, pendingDecision: undefined };
}

function artifactsForDecision(state: WorkflowState): VersionedArtifactRef[] {
  if (state.phase.includes("design")) return state.artifacts.design ? [state.artifacts.design] : [];
  return [state.artifacts.requirements, state.artifacts.tasks].filter((artifact): artifact is VersionedArtifactRef => Boolean(artifact));
}

function reviewTargetForPhase(phase: WorkflowPhase): "design" | "plan" {
  return phase === "awaiting-design-review-decision" ? "design" : "plan";
}

function isDecisionPhase(phase: WorkflowPhase): boolean {
  return phase === "awaiting-design-review-decision" || phase === "awaiting-plan-review-decision" || phase === "awaiting-design-approval" || phase === "awaiting-plan-approval";
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
