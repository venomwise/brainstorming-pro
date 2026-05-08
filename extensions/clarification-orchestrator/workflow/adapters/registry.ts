import { brainstormingAdapter } from "./brainstorming.ts";
import { specPlanAdapter } from "./spec-plan.ts";
import { specExecAdapter } from "./spec-exec.ts";
import { createAdapterRegistry } from "./types.ts";
import { designReviewAdapter } from "./design-review.ts";
import { planReviewAdapter } from "./plan-review.ts";
import { executionReviewAdapter } from "./execution-review.ts";

export const defaultAdapterRegistry = createAdapterRegistry([
  brainstormingAdapter,
  specPlanAdapter,
  specExecAdapter,
  designReviewAdapter,
  planReviewAdapter,
  executionReviewAdapter,
]);
