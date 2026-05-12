import type { PhaseAdapter } from "./types.ts";
import type { ReviewPhaseStatus, WorkflowState } from "../types.ts";
import { runPlanReviewPanel } from "./plan-review/panel.ts";

export type PlanReviewAdapterOptions = { projectRoot: string; model: string };

export function createPlanReviewAdapter(options: PlanReviewAdapterOptions): PhaseAdapter<WorkflowState, WorkflowState> {
  return {
    name: "plan-review",
    phase: "plan-review",
    allowedFrom: ["plan-review"],
    requiredArtifacts: ["design", "requirements", "tasks"],
    async run(state) {
      const result = await runPlanReviewPanel({ topic: state.topic, workflowRunId: state.runId, projectRoot: options.projectRoot, topicDir: `${options.projectRoot}/specs/${state.topic}`, state, model: options.model });
      const planStatus: ReviewPhaseStatus = {
        target: "plan",
        mode: "minimal",
        status: result.status,
        artifacts: [state.artifacts.requirements, state.artifacts.tasks].filter(Boolean) as ReviewPhaseStatus["artifacts"],
        readinessStatus: result.readiness.status,
        enhancedReadiness: result.readiness,
        reason: result.readiness.summary,
        planReview: result.artifactBinding ? { automatic: true, reviewRunId: result.reviewRunId, ledgerPath: result.ledgerPath, readinessStatus: result.readiness.status, reviewedArtifacts: [result.artifactBinding.requirements, result.artifactBinding.tasks] } : undefined,
        completedAt: new Date().toISOString(),
      };
      return { ...state, phase: result.status === "passed" ? "awaiting-plan-approval" : result.status === "failed" ? "failed" : "blocked", reviewStatus: { ...state.reviewStatus, plan: planStatus }, lastError: result.status === "passed" ? undefined : { message: result.readiness.summary, phase: "plan-review", recoverable: result.status !== "failed", occurredAt: new Date().toISOString(), details: result.error } };
    },
    validate(output) {
      if (!output.reviewStatus.plan) throw new Error("Plan review adapter must write plan review status.");
    },
    commit(output) { return output; },
  };
}

export const planReviewAdapter: PhaseAdapter<ReviewPhaseStatus, ReviewPhaseStatus> = {
  name: "plan-review",
  phase: "plan-review",
  allowedFrom: ["plan-review"],
  requiredArtifacts: ["design", "requirements", "tasks"],
  run(input) { return input; },
  validate(output) {
    if (output.target !== "plan") throw new Error("Plan review status must target plan.");
  },
  commit(output, state: WorkflowState) {
    return { ...state, phase: output.status === "passed" ? "awaiting-plan-approval" : output.status === "failed" ? "failed" : "blocked", reviewStatus: { ...state.reviewStatus, plan: output } };
  },
};
