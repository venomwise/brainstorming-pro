import type { ReviewDecisionRef, ReviewMode } from "../../types.ts";
import type { DesignReviewMode } from "./types.ts";

const supportedModes = new Set<ReviewMode>(["skip", "minimal", "full"]);

export function resolveDesignReviewMode(decision: ReviewDecisionRef): DesignReviewMode {
  if (decision.target !== "design") throw new Error(`Review decision target must be design, got ${decision.target}.`);
  return assertSupportedDesignReviewMode(decision.mode);
}

export function assertSupportedDesignReviewMode(mode: string): DesignReviewMode {
  if (!supportedModes.has(mode as ReviewMode)) throw new Error(`Unsupported design review mode: ${mode}`);
  return mode as DesignReviewMode;
}
