import { createBrainstormingAdapter } from "./brainstorming.ts";
import { createSpecPlanAdapter } from "./spec-plan.ts";
import { createSpecExecAdapter } from "./spec-exec.ts";
import type { PhaseAdapter } from "./types.ts";
import type { AgentBackedAdapterOptions } from "./agent-backed.ts";
import type { WorkflowAdapter } from "../runtime.ts";
import type { WorkflowState } from "../types.ts";
import { createDesignReviewAdapter } from "./design-review.ts";
import { createPlanReviewAdapter } from "./plan-review.ts";

export function defaultWorkflowAdapters(projectRoot: string, model: string, onWorkflowProgress?: AgentBackedAdapterOptions["onWorkflowProgress"]) {
  return {
    designing: asWorkflowAdapter(createBrainstormingAdapter({ projectRoot, model, onWorkflowProgress })),
    planning: asWorkflowAdapter(createSpecPlanAdapter({ projectRoot, model, onWorkflowProgress })),
    "design-review": asWorkflowAdapter(createDesignReviewAdapter({ projectRoot, model, onWorkflowProgress })),
    "plan-review": asWorkflowAdapter(createPlanReviewAdapter({ projectRoot, model })),
    executing: asWorkflowAdapter(createSpecExecAdapter({ projectRoot, model, onWorkflowProgress })),
  };
}

function asWorkflowAdapter(adapter: PhaseAdapter<WorkflowState>): WorkflowAdapter {
  return {
    async run(state) {
      const output = await adapter.run(state, state);
      await adapter.validate(output, state);
      return adapter.commit(output, state);
    },
  };
}
