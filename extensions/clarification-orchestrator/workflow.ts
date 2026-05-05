import type { RunPaths } from "./artifact-store.ts";
import { appendStateError, loadState, saveState, updateStatePhase } from "./artifact-store.ts";
import type { ClarifyOptions, WorkflowError, WorkflowPhase, WorkflowState } from "./types.ts";

export type WorkflowContext = {
  hasUI: boolean;
  cwd: string;
};

export type WorkflowServices = {
  paths: RunPaths;
  ctx: WorkflowContext;
  options: ClarifyOptions;
  onPhase?: (phase: WorkflowPhase, state: WorkflowState) => Promise<void> | void;
};

const phaseOrder: WorkflowPhase[] = [
  "INIT",
  "DISCOVERY",
  "INITIAL_DESIGN",
  "REVIEW",
  "TRIAGE",
  "USER_DECISION",
  "REFINE",
  "VERIFY",
  "FINAL_APPROVAL",
  "COMPLETE",
];

export class ClarificationWorkflow {
  private readonly services: WorkflowServices;

  constructor(services: WorkflowServices) {
    this.services = services;
  }

  async runWorkflow(): Promise<WorkflowState> {
    let state = await loadState(this.services.paths);
    await this.persistPhase("INIT");

    for (const phase of phaseOrder.slice(1)) {
      state = await this.transitionPhase(phase);
      if (this.evaluateTermination(state)) break;
    }

    return loadState(this.services.paths);
  }

  async resumeWorkflow(): Promise<WorkflowState> {
    const state = await loadState(this.services.paths);
    const nextPhase = nextRecoverablePhase(state.phase);
    if (!nextPhase) return state;
    return this.transitionPhase(nextPhase);
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
  if (state.refinementAttempts < state.options.maxRounds) return { action: "refine", issueIds: unresolved };
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

function nextRecoverablePhase(current: WorkflowPhase): WorkflowPhase | undefined {
  const index = phaseOrder.indexOf(current);
  if (index === -1) return undefined;
  return phaseOrder[index + 1];
}
