import type { PhaseAdapter, AdapterPhaseResult } from "./types.ts";
import type { WorkflowState } from "../types.ts";

export type SpecExecAdapterOutput = AdapterPhaseResult;

export const controlledExecutionDeferredReason = "controlled-spec-exec-adapter-unavailable";

export const specExecAdapter: PhaseAdapter<WorkflowState, AdapterPhaseResult> = {
  name: "spec-exec",
  phase: "executing",
  allowedFrom: ["executing"],
  requiredArtifacts: ["requirements", "tasks"],
  run() {
    return {
      kind: "blocked",
      reason: controlledExecutionDeferredReason,
      diagnostics: {
        message: "SpecExecPhaseAdapter is intentionally unavailable until the controlled execution adapter spec is implemented.",
        futureContract: {
          architecture: "code-owned task loop plus LLM single-task worker",
          codeOwns: ["task parsing", "next-task selection", "optional mode", "checkpoint selection", "checkbox updates", "stop conditions", "task evidence", "execution report persistence"],
          llmWorker: "executes exactly one current task at a time and must not update tasks.md progress markers",
        },
      },
    };
  },
  validate(output) {
    if (output.kind !== "blocked") throw new Error("Spec-exec adapter must remain blocked until controlled execution is implemented.");
  },
  commit(output) {
    return output;
  },
};
