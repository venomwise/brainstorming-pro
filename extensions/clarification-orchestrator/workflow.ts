import type { RunPaths } from "./artifact-store.ts";
import { appendStateError, loadState, saveState, updateStatePhase } from "./artifact-store.ts";
import type { BrainstormingProConfig, ClarifyOptions, ResumeStatus, WorkflowError, WorkflowPhase, WorkflowState } from "./types.ts";

export type WorkflowContext = {
  hasUI: boolean;
  cwd: string;
};

export type WorkflowServices = {
  paths: RunPaths;
  ctx: WorkflowContext;
  options: ClarifyOptions;
  config?: BrainstormingProConfig;
  onPhase?: (phase: WorkflowPhase, state: WorkflowState) => Promise<void> | void;
};

const designGatePhaseOrder: WorkflowPhase[] = [
  "INIT",
  "REQUEST_CAPTURE",
  "TOPIC_PROPOSAL",
  "TOPIC_CONFIRMATION",
  "V0_BRAINSTORMING",
  "DESIGN_REVIEW_GATE",
];

export class ClarificationWorkflow {
  private readonly services: WorkflowServices;

  constructor(services: WorkflowServices) {
    this.services = services;
  }

  async runWorkflow(): Promise<WorkflowState> {
    let state = await loadState(this.services.paths);
    await this.persistPhase("INIT");

    for (const phase of designGatePhaseOrder.slice(1)) {
      state = await this.transitionPhase(phase);
      if (phase === "DESIGN_REVIEW_GATE" || this.evaluateTermination(state)) break;
    }

    return loadState(this.services.paths);
  }

  async resumeWorkflow(): Promise<WorkflowState> {
    const state = await loadState(this.services.paths);
    const resumePhase = phaseForResumeStatus(state.metadata.resumeStatus, state.phase);
    if (!resumePhase || resumePhase === state.phase) return state;
    return this.transitionPhase(resumePhase);
  }

  async transitionPhase(phase: WorkflowPhase): Promise<WorkflowState> {
    await this.persistPhase(phase);
    const state = await loadState(this.services.paths);
    await this.services.onPhase?.(phase, state);
    return state;
  }

  evaluateTermination(state: WorkflowState): boolean {
    return state.phase === "COMPLETE" || state.phase === "ABORTED" || state.phase === "INTERRUPTED";
  }

  async recordFailure(error: WorkflowError): Promise<WorkflowState> {
    await appendStateError(this.services.paths, error);
    const state = await loadState(this.services.paths);
    state.phase = "ABORTED";
    await saveState(this.services.paths, state);
    return state;
  }

  private async persistPhase(phase: WorkflowPhase): Promise<WorkflowState> {
    const state = await updateStatePhase(this.services.paths, phase);
    if (phase === "COMPLETE") {
      state.execution.status = "complete";
      await saveState(this.services.paths, state);
    }
    return state;
  }
}

export async function runWorkflow(services: WorkflowServices): Promise<WorkflowState> {
  return new ClarificationWorkflow(services).runWorkflow();
}

export async function resumeWorkflow(services: WorkflowServices): Promise<WorkflowState> {
  return new ClarificationWorkflow(services).resumeWorkflow();
}

export async function transitionPhase(paths: RunPaths, phase: WorkflowPhase): Promise<WorkflowState> {
  return updateStatePhase(paths, phase);
}

export function evaluateTermination(state: WorkflowState): boolean {
  return state.phase === "COMPLETE" || state.phase === "ABORTED" || state.phase === "INTERRUPTED";
}

export type VerificationLoopDecision =
  | { action: "complete" }
  | { action: "refine"; issueIds: string[] }
  | { action: "max-rounds-reached"; issueIds: string[]; options: Array<"accept" | "manual-edit" | "increase-max-rounds" | "abort"> };

export function evaluateVerificationLoop(state: WorkflowState): VerificationLoopDecision {
  const unresolved = state.verification.unresolvedP0P1;
  if (unresolved.length === 0) return { action: "complete" };
  const maxRounds = state.metadata.latestVersion === undefined ? 2 : Math.max(0, state.metadata.latestVersion + 2);
  if (state.refinementAttempts < maxRounds) return { action: "refine", issueIds: unresolved };
  return {
    action: "max-rounds-reached",
    issueIds: unresolved,
    options: ["accept", "manual-edit", "increase-max-rounds", "abort"],
  };
}

export async function applyVerificationLoopDecision(paths: RunPaths, decision: VerificationLoopDecision): Promise<WorkflowState> {
  const state = await loadState(paths);
  if (decision.action === "complete") state.phase = "FINAL_APPROVAL";
  if (decision.action === "refine") state.phase = "REFINE";
  if (decision.action === "max-rounds-reached") state.phase = "USER_DECISION";
  await saveState(paths, state);
  return state;
}

function phaseForResumeStatus(status: ResumeStatus, current: WorkflowPhase): WorkflowPhase | undefined {
  switch (status) {
    case "awaiting-topic-confirmation":
      return "TOPIC_CONFIRMATION";
    case "awaiting-design-gate-decision":
      return "DESIGN_REVIEW_GATE";
    case "awaiting-issue-decisions":
      return "ISSUE_DECISION_GATE";
    case "in-cross-review":
      return current === "REVIEW" ? "TRIAGE" : "REVIEW";
    case "recoverable-failure":
      return current;
    case "completed":
      return undefined;
  }
}
