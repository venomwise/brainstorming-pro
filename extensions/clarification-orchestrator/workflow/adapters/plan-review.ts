import type { PhaseAdapter } from "./types.ts";
import type { ReviewPhaseStatus, WorkflowState } from "../types.ts";

export const planReviewAdapter: PhaseAdapter<ReviewPhaseStatus, ReviewPhaseStatus> = {
  name: "plan-review",
  phase: "plan-review",
  allowedFrom: ["plan-review"],
  requiredArtifacts: ["requirements", "tasks"],
  run(input) {
    if (input.mode === "full") return { ...input, status: "unavailable", reason: "full-review-unavailable" };
    if (input.mode === "skip") return { ...input, status: "skipped", reason: "user-selected-skip" };
    return input;
  },
  validate(output) {
    if (output.mode === "minimal" && output.status !== "passed" && output.status !== "blocked" && output.status !== "failed") throw new Error("Minimal plan review must return passed, blocked, or failed.");
  },
  commit(output, state: WorkflowState) {
    return { ...state, phase: output.status === "passed" || output.status === "skipped" ? "awaiting-plan-approval" : state.phase, reviewStatus: { ...state.reviewStatus, plan: output } };
  },
};
