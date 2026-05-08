import type { PhaseAdapter } from "./types.ts";
import type { VersionedArtifactRef, WorkflowState } from "../types.ts";

export type SpecPlanAdapterOutput = {
  requirements: VersionedArtifactRef;
  tasks: VersionedArtifactRef;
};

export const specPlanAdapter: PhaseAdapter<SpecPlanAdapterOutput, SpecPlanAdapterOutput> = {
  name: "spec-plan",
  phase: "planning",
  allowedFrom: ["planning"],
  requiredArtifacts: ["design"],
  run(input) {
    return input;
  },
  validate(output) {
    if (output.requirements.kind !== "requirements" || output.tasks.kind !== "tasks") throw new Error("Spec-plan adapter must produce requirements and tasks artifacts.");
  },
  commit(output, state: WorkflowState) {
    return { ...state, phase: "awaiting-plan-review-decision", artifacts: { ...state.artifacts, requirements: output.requirements, tasks: output.tasks } };
  },
};
