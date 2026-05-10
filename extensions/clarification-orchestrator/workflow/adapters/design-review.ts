import type { PhaseAdapter } from "./types.ts";
import type { WorkflowState, ReviewPhaseStatus } from "../types.ts";
import { runDesignReviewPanel } from "./design-review/panel.ts";
import type { AgentBackedAdapterOptions } from "./agent-backed.ts";

export function createDesignReviewAdapter(options: AgentBackedAdapterOptions): PhaseAdapter<WorkflowState, ReviewPhaseStatus> {
  return {
  name: "design-review",
  phase: "design-review",
  allowedFrom: ["design-review"],
  requiredArtifacts: ["design"],
  async run(state) {
    const result = await runDesignReviewPanel(state, options);
    return {
      target: "design",
      mode: result.mode,
      status: result.status,
      artifacts: [result.designRef],
      ...(result.status === "skipped" ? { reason: result.reason } : {}),
      ...(result.status === "unavailable" ? { reason: result.unavailableReason } : {}),
      ...(result.status === "failed" && result.error ? { reason: result.error.message } : {}),
      completedAt: new Date().toISOString(),
    };
  },
  validate(output) {
    if (output.target !== "design") throw new Error("Design review output must target design.");
    if (!(["skip", "minimal", "full"] as const).includes(output.mode)) throw new Error("Design review mode is invalid.");
    if (!["skipped", "passed", "blocked", "failed", "unavailable"].includes(output.status)) throw new Error("Design review status is invalid.");
  },
  commit(output, state) {
    const phase = output.status === "skipped" || output.status === "passed" ? "awaiting-design-approval" : output.status === "failed" ? "failed" : "blocked";
    return {
      ...state,
      phase,
      reviewStatus: {
        ...state.reviewStatus,
        design: output,
      },
      updatedAt: new Date().toISOString(),
    };
  },
};
}

export const designReviewAdapter: PhaseAdapter<WorkflowState, ReviewPhaseStatus> = createDesignReviewAdapter({
  projectRoot: process.cwd(),
  model: process.env.BRAINSTORMING_PRO_AGENT_MODEL ?? "openai:gpt-4o-mini",
});
