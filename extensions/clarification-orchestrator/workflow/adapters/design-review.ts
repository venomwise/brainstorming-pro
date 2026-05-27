import type { PhaseAdapter } from "./types.ts";
import type { WorkflowState, ReviewPhaseStatus } from "../types.ts";
import { runDesignReviewPanel } from "./design-review/panel.ts";
import { buildDesignReviewRecoveryActions } from "./design-review/recovery-actions.ts";
import type { AgentBackedAdapterOptions } from "./agent-backed.ts";

export function createDesignReviewAdapter(options: AgentBackedAdapterOptions): PhaseAdapter<WorkflowState, ReviewPhaseStatus> {
  return {
  name: "design-review",
  phase: "design-review",
  allowedFrom: ["design-review"],
  requiredArtifacts: ["design"],
  async run(state) {
    const result = await runDesignReviewPanel(state, options);
    const recoveryActions = result.aggregate ? buildDesignReviewRecoveryActions({
      reviewRunId: result.reviewRunId,
      ledgerPath: result.ledgerPath,
      designRef: result.designRef,
      status: result.status,
      readiness: result.readiness,
      coverage: result.aggregate.coverage,
      ledgerHealthy: true,
    }) : undefined;
    return {
      target: "design",
      mode: result.mode,
      status: result.status,
      artifacts: [result.designRef],
      readinessStatus: result.enhancedReadiness?.status ?? result.readiness.status,
      enhancedReadiness: result.enhancedReadiness,
      triageSummary: result.triageSummary,
      triage: result.triage ? { mustFix: result.triage.clusters.filter((cluster) => cluster.triageLevel === "must-fix").length, shouldFix: result.triage.clusters.filter((cluster) => cluster.triageLevel === "should-fix").length, notes: result.triage.clusters.filter((cluster) => cluster.triageLevel === "note").length, conflicts: result.triage.conflicts.length, unresolvedQuestions: result.triage.unresolvedQuestions.length } : undefined,
      coverage: result.aggregate?.coverage,
      recoveryActions,
      ...(result.status === "skipped" ? { reason: result.reason } : {}),
      ...(result.status === "unavailable" ? { reason: result.unavailableReason } : {}),
      ...(result.status === "failed" && result.error ? { reason: result.error.message } : {}),
      ...(result.status === "partial" ? { reason: "incomplete-design-review" } : {}),
      completedAt: new Date().toISOString(),
    };
  },
  validate(output) {
    if (output.target !== "design") throw new Error("Design review output must target design.");
    if (!(["skip", "minimal", "full"] as const).includes(output.mode)) throw new Error("Design review mode is invalid.");
    if (!["skipped", "passed", "blocked", "failed", "partial", "unavailable"].includes(output.status)) throw new Error("Design review status is invalid.");
  },
  commit(output, state) {
    const phase = output.status === "skipped" || output.status === "passed" ? "awaiting-design-approval" : output.status === "failed" ? "failed" : "blocked";
    return {
      ...state,
      phase,
      reviewStatus: {
        ...state.reviewStatus,
        design: output,
      },
      ...(output.status === "partial" ? { lastError: { message: "incomplete-design-review", phase: "design-review" as const, recoverable: true, occurredAt: new Date().toISOString(), details: { recoveryActions: output.recoveryActions, coverage: output.coverage } } } : {}),
      updatedAt: new Date().toISOString(),
    };
  },
};
}

