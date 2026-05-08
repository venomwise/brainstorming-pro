import type { ReviewMode, WorkflowPhase } from "./types.ts";

export type TransitionContext = {
  reviewMode?: ReviewMode;
};

const terminalPhases = new Set<WorkflowPhase>(["done"]);

const unconditionalTransitions: Partial<Record<WorkflowPhase, WorkflowPhase[]>> = {
  designing: ["awaiting-design-review-decision", "blocked", "failed"],
  "design-review": ["awaiting-design-approval", "blocked", "failed"],
  "awaiting-design-approval": ["planning", "designing", "blocked", "failed"],
  planning: ["awaiting-plan-review-decision", "blocked", "failed"],
  "plan-review": ["awaiting-plan-approval", "blocked", "failed"],
  "awaiting-plan-approval": ["executing", "planning", "blocked", "failed"],
  executing: ["execution-review", "done", "blocked", "failed"],
  "execution-review": ["done", "executing", "blocked", "failed"],
  blocked: ["designing", "planning", "executing", "failed"],
  failed: ["blocked"],
};

export function canTransition(from: WorkflowPhase, to: WorkflowPhase, context: TransitionContext = {}): boolean {
  if (from === to) return true;
  if (terminalPhases.has(from)) return false;

  if (from === "awaiting-design-review-decision") {
    if (to === "awaiting-design-approval") return context.reviewMode === "skip";
    if (to === "design-review") return context.reviewMode === "minimal" || context.reviewMode === "full";
    return to === "designing" || to === "blocked" || to === "failed";
  }

  if (from === "awaiting-plan-review-decision") {
    if (to === "awaiting-plan-approval") return context.reviewMode === "skip";
    if (to === "plan-review") return context.reviewMode === "minimal" || context.reviewMode === "full";
    return to === "planning" || to === "blocked" || to === "failed";
  }

  return unconditionalTransitions[from]?.includes(to) ?? false;
}

export function assertTransitionAllowed(from: WorkflowPhase, to: WorkflowPhase, context: TransitionContext = {}): void {
  if (!canTransition(from, to, context)) {
    const detail = context.reviewMode ? ` with review mode '${context.reviewMode}'` : "";
    throw new Error(`Illegal workflow transition: ${from} -> ${to}${detail}`);
  }
}

export function transition(from: WorkflowPhase, to: WorkflowPhase, context: TransitionContext = {}): WorkflowPhase {
  assertTransitionAllowed(from, to, context);
  return to;
}
