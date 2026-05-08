import type { PhaseAdapter } from "./types.ts";
import type { ReviewPhaseStatus, WorkflowState } from "../types.ts";

export const designReviewAdapter: PhaseAdapter<ReviewPhaseStatus, ReviewPhaseStatus> = {
  name: "design-review",
  phase: "design-review",
  allowedFrom: ["design-review"],
  requiredArtifacts: ["design"],
  run(input) {
    if (input.mode === "full") return { ...input, status: "unavailable", reason: "full-review-unavailable" };
    if (input.mode === "skip") return { ...input, status: "skipped", reason: "user-selected-skip" };
    return input;
  },
  validate(output) {
    if (output.mode === "minimal" && output.status !== "passed" && output.status !== "blocked" && output.status !== "failed") throw new Error("Minimal design review must return passed, blocked, or failed.");
  },
  commit(output, state: WorkflowState) {
    return { ...state, phase: output.status === "passed" || output.status === "skipped" ? "awaiting-design-approval" : state.phase, reviewStatus: { ...state.reviewStatus, design: output } };
  },
};
