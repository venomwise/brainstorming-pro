import type { PhaseAdapter } from "./types.ts";
import type { WorkflowState } from "../types.ts";

export type SpecExecAdapterOutput = {
  done: boolean;
};

export const specExecAdapter: PhaseAdapter<SpecExecAdapterOutput, SpecExecAdapterOutput> = {
  name: "spec-exec",
  phase: "executing",
  allowedFrom: ["executing"],
  requiredArtifacts: ["requirements", "tasks"],
  run(input) {
    return input;
  },
  validate(output) {
    if (!output.done) throw new Error("Spec-exec adapter output did not report completion.");
  },
  commit(_output, state: WorkflowState) {
    return { ...state, phase: "done" };
  },
};
