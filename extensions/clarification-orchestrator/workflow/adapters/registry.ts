import { createBrainstormingAdapter } from "./brainstorming.ts";
import { createSpecPlanAdapter } from "./spec-plan.ts";
import { createSpecExecAdapter, specExecAdapter } from "./spec-exec.ts";
import { createAdapterRegistry, type PhaseAdapter } from "./types.ts";
import type { WorkflowAdapter } from "../runtime.ts";
import type { WorkflowState } from "../types.ts";
import { createDesignReviewAdapter, designReviewAdapter } from "./design-review.ts";
import { createPlanReviewAdapter, planReviewAdapter } from "./plan-review.ts";
import { executionReviewAdapter } from "./execution-review.ts";

export function defaultWorkflowAdapters(projectRoot: string, model = process.env.BRAINSTORMING_PRO_AGENT_MODEL ?? "openai:gpt-4o-mini") {
  return {
    designing: asWorkflowAdapter(createBrainstormingAdapter({ projectRoot, model })),
    planning: asWorkflowAdapter(createSpecPlanAdapter({ projectRoot, model })),
    "design-review": asWorkflowAdapter(createDesignReviewAdapter({ projectRoot, model })),
    "plan-review": asWorkflowAdapter(createPlanReviewAdapter({ projectRoot, model })),
    executing: asWorkflowAdapter(createSpecExecAdapter({ projectRoot, model })),
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

export const defaultAdapterRegistry = createAdapterRegistry([
  createBrainstormingAdapter({ projectRoot: process.cwd(), model: process.env.BRAINSTORMING_PRO_AGENT_MODEL ?? "openai:gpt-4o-mini" }),
  createSpecPlanAdapter({ projectRoot: process.cwd(), model: process.env.BRAINSTORMING_PRO_AGENT_MODEL ?? "openai:gpt-4o-mini" }),
  specExecAdapter,
  designReviewAdapter,
  planReviewAdapter,
  executionReviewAdapter,
]);
