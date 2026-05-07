import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunPaths } from "./artifact-store.ts";
import { appendStateError, loadState, saveState, updateStatePhase } from "./artifact-store.ts";
import { discoverAgents } from "./agents.ts";
import { runDiscoveryPhase } from "./phases/discovery.ts";
import { runFinalApprovalPhase } from "./phases/final-approval.ts";
import { runConversationalRevisionPhase } from "./phases/conversational-revision.ts";
import { presentDesignReviewGate } from "./user-gate.ts";
import type { BrainstormingProConfig, ClarifyOptions, ResumeStatus, WorkflowError, WorkflowPhase, WorkflowState } from "./types.ts";

export type WorkflowContext = {
  hasUI: boolean;
  cwd: string;
  ask?: (prompt: string) => Promise<string>;
};

export type WorkflowServices = {
  paths: RunPaths;
  ctx: WorkflowContext;
  options: ClarifyOptions;
  config?: BrainstormingProConfig;
  onPhase?: (phase: WorkflowPhase, state: WorkflowState) => Promise<void> | void;
  runDiscovery?: typeof runDiscoveryPhase;
};

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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
      state = phase === "V0_BRAINSTORMING" ? await this.runV0Brainstorming() : await this.transitionPhase(phase);
      if (phase === "DESIGN_REVIEW_GATE") state = await this.runDesignReviewGate(state);
      if (phase === "DESIGN_REVIEW_GATE" || this.evaluateTermination(state)) break;
    }

    return loadState(this.services.paths);
  }

  async resumeWorkflow(): Promise<WorkflowState> {
    const state = await loadState(this.services.paths);
    if (state.metadata.resumeStatus === "awaiting-design-gate-decision") return this.runDesignReviewGate(state);
    const resumePhase = phaseForResumeStatus(state.metadata.resumeStatus, state.phase);
    if (!resumePhase || resumePhase === state.phase) return state;
    return this.transitionPhase(resumePhase);
  }

  async runV0Brainstorming(): Promise<WorkflowState> {
    await this.persistPhase("V0_BRAINSTORMING");
    const state = await loadState(this.services.paths);
    await this.services.onPhase?.("V0_BRAINSTORMING", state);
    if (!this.services.config) throw new Error("Clarification workflow requires loaded config for V0 brainstorming.");
    try {
      const agents = await discoverAgents({ packageRoot, cwd: this.services.ctx.cwd, includeUserOverrides: true, includeProjectOverrides: this.services.config.security.allowProjectAgents });
      const designer = agents.find((agent) => agent.role === "designer" || agent.name === "designer");
      if (!designer) throw new Error("No designer agent found for V0 brainstorming.");
      const discovery = this.services.runDiscovery ?? runDiscoveryPhase;
      const updated = await discovery({ paths: this.services.paths, state, config: this.services.config, designer, cwd: this.services.ctx.cwd, packageRoot });
      await this.services.onPhase?.(updated.phase, updated);
      return loadState(this.services.paths);
    } catch (error) {
      return this.recordFailure({ type: "unknown", message: error instanceof Error ? error.message : String(error), phase: "V0_BRAINSTORMING", recoverable: true, occurredAt: new Date().toISOString() });
    }
  }

  async runDesignReviewGate(state: WorkflowState): Promise<WorkflowState> {
    const ready = await this.assertDesignArtifactReady(state);
    if (this.evaluateTermination(ready)) return ready;
    const latest = ready.designVersions?.find((version) => version.version === ready.metadata.latestVersion) ?? ready.designVersions?.at(-1);
    const decision = await presentDesignReviewGate({
      paths: this.services.paths,
      version: latest?.version ?? ready.metadata.latestVersion,
      designPath: this.services.paths.designPath,
      changeSummary: latest?.changeSummary,
      openQuestions: [],
      pendingBlockers: ready.pendingDecisions,
      ctx: { hasUI: this.services.ctx.hasUI, ask: this.services.ctx.ask },
    });
    if (decision.action === "save") return loadState(this.services.paths);
    if (decision.action === "approve") return runFinalApprovalPhase({ paths: this.services.paths, approved: true });
    if (decision.action === "revise") return runConversationalRevisionPhase({ paths: this.services.paths, revision: { feedback: decision.reason ?? "Revision requested from design gate.", classification: "clarification" } });
    if (decision.action === "review") {
      const current = await loadState(this.services.paths);
      current.phase = "REVIEW";
      current.metadata.currentPhase = "REVIEW";
      current.metadata.resumeStatus = "in-cross-review";
      await saveState(this.services.paths, current);
      return current;
    }
    return loadState(this.services.paths);
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

  private async assertDesignArtifactReady(state: WorkflowState): Promise<WorkflowState> {
    const latest = state.designVersions?.find((version) => version.version === state.metadata.latestVersion) ?? state.designVersions?.at(-1);
    const candidates = [this.services.paths.designPath, latest?.designPath].filter((candidate): candidate is string => Boolean(candidate));
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
      } catch {
        return this.recordFailure({ type: "artifact-write", message: `Design review gate cannot be presented because design artifact is missing: ${candidate}`, phase: "DESIGN_REVIEW_GATE", recoverable: true, path: candidate, occurredAt: new Date().toISOString() });
      }
    }
    if (candidates.length === 0) {
      return this.recordFailure({ type: "artifact-write", message: "Design review gate cannot be presented because no design artifact metadata exists.", phase: "DESIGN_REVIEW_GATE", recoverable: true, occurredAt: new Date().toISOString() });
    }
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
