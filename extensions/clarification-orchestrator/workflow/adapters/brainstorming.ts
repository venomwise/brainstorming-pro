import type { PhaseAdapter } from "./types.ts";
import type { VersionedArtifactRef, WorkflowState } from "../types.ts";

export type BrainstormingAdapterOutput = {
  design: VersionedArtifactRef;
};

export const brainstormingAdapter: PhaseAdapter<{ design: VersionedArtifactRef }, BrainstormingAdapterOutput> = {
  name: "brainstorming",
  phase: "designing",
  allowedFrom: ["designing"],
  requiredArtifacts: [],
  run(input) {
    return { design: input.design };
  },
  validate(output) {
    if (output.design.kind !== "design") throw new Error("Brainstorming adapter must produce a design artifact.");
  },
  commit(output, state: WorkflowState) {
    return { ...state, phase: "awaiting-design-review-decision", artifacts: { ...state.artifacts, design: output.design } };
  },
};
