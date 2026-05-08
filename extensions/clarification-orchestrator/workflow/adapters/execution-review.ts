import type { PhaseAdapter } from "./types.ts";
import type { ReviewPhaseStatus, WorkflowState } from "../types.ts";

export const executionReviewAdapter: PhaseAdapter<ReviewPhaseStatus, ReviewPhaseStatus> = {
  name: "execution-review",
  phase: "execution-review",
  allowedFrom: ["execution-review"],
  requiredArtifacts: ["requirements", "tasks"],
  run(input) {
    if (input.mode === "full") return { ...input, status: "unavailable", reason: "full-review-unavailable" };
    if (input.mode === "skip") return { ...input, status: "skipped", reason: "user-selected-skip" };
    return input;
  },
  validate() {},
  commit(output, state: WorkflowState) {
    return { ...state, phase: output.status === "passed" || output.status === "skipped" ? "done" : state.phase, reviewStatus: { ...state.reviewStatus, execution: output } };
  },
};
