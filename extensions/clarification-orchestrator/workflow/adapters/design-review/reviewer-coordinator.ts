import { resolveRunAgent, workflowAgentProgressCallback, type AgentBackedAdapterOptions, type RunAgentFunction } from "../agent-backed.ts";
import { buildMinimalDesignReviewPrompt, buildMinimalDesignReviewSystemPrompt } from "./prompts/minimal-review.ts";
import { minimalDesignReviewOutputSchema } from "./schemas.ts";
import { normalizeDesignReviewFindings } from "./finding-normalizer.ts";
import { FULL_DESIGN_REVIEWER_ORDER, resolveFullDesignReviewerSet, type FullDesignReviewerRole } from "./full-reviewer-registry.ts";
import { runFullDesignReviewer } from "./full-reviewer-runner.ts";
import type { BoundDesignArtifact } from "./artifact-binding.ts";
import type { DesignReviewerResult, MinimalDesignReviewOutput } from "./types.ts";
import type { WorkflowState } from "../../types.ts";

export type ReviewerCoordinatorOptions = Pick<AgentBackedAdapterOptions, "projectRoot" | "model"> & {
  runAgent?: RunAgentFunction;
};

export { resolveFullDesignReviewerSet } from "./full-reviewer-registry.ts";
export type { FullDesignReviewerRole } from "./full-reviewer-registry.ts";

export async function runDesignReviewers(input: {
  mode: "minimal" | "full";
  reviewRunId: string;
  artifact: BoundDesignArtifact;
  state: WorkflowState;
  options: ReviewerCoordinatorOptions;
  selectedFullReviewerRoles?: readonly FullDesignReviewerRole[];
}): Promise<DesignReviewerResult[]> {
  if (input.mode === "minimal") return [await runMinimalDesignReviewer(input)];
  return await runFullDesignReviewers(input);
}

export async function runFullDesignReviewers(input: {
  reviewRunId: string;
  artifact: BoundDesignArtifact;
  state: WorkflowState;
  options: ReviewerCoordinatorOptions;
  selectedFullReviewerRoles?: readonly FullDesignReviewerRole[];
}): Promise<DesignReviewerResult[]> {
  const selectedFullReviewerRoles = input.selectedFullReviewerRoles ? orderFullReviewerRoles(input.selectedFullReviewerRoles) : undefined;
  const reviewers = resolveFullDesignReviewerSet(selectedFullReviewerRoles);
  return await Promise.all(reviewers.map((reviewer) => runFullDesignReviewer({ ...input, reviewer })));
}

function orderFullReviewerRoles(roles: readonly FullDesignReviewerRole[]): FullDesignReviewerRole[] {
  const selected = new Set(roles);
  return FULL_DESIGN_REVIEWER_ORDER.filter((role) => selected.has(role));
}

export async function runMinimalDesignReviewer(input: {
  reviewRunId: string;
  artifact: BoundDesignArtifact;
  state: WorkflowState;
  options: ReviewerCoordinatorOptions;
}): Promise<DesignReviewerResult> {
  const run = input.options.runAgent ?? resolveRunAgent(input.options);
  const prompt = buildMinimalDesignReviewPrompt({ topic: input.state.topic, designRef: input.artifact.ref, designContent: input.artifact.content });
  const startedAt = new Date().toISOString();
  const result = await run<MinimalDesignReviewOutput>({
    role: "minimal-reviewer",
    purpose: "Review Brainstorming Pro design artifact",
    prompt,
    systemPrompt: buildMinimalDesignReviewSystemPrompt(),
    model: input.options.model,
    workflow: {
      topic: input.state.topic,
      runId: input.state.runId,
      phase: "design-review",
      projectRoot: input.options.projectRoot,
      topicDir: input.artifact.topicDir,
      artifacts: input.state.artifacts,
      state: input.state,
    },
    outputSchema: minimalDesignReviewOutputSchema,
    onProgress: workflowAgentProgressCallback(input.options, input.state, "design-review"),
  });
  if (result.status !== "succeeded" || !result.output) {
    return {
      reviewRunId: input.reviewRunId,
      reviewerRole: "minimal-reviewer",
      status: "failed",
      findings: [],
      error: result.error ?? { kind: result.status, message: `Minimal reviewer ${result.status}.`, retryable: result.status === "failed" || result.status === "timed-out" },
      startedAt: result.startedAt ?? startedAt,
      completedAt: result.completedAt ?? new Date().toISOString(),
    };
  }
  try {
    const findings = normalizeDesignReviewFindings({
      reviewRunId: input.reviewRunId,
      designRef: input.artifact.ref,
      reviewerRole: "minimal-reviewer",
      findings: result.output.findings,
      topicDir: input.artifact.topicDir,
    });
    return {
      reviewRunId: input.reviewRunId,
      reviewerRole: "minimal-reviewer",
      status: "succeeded",
      summary: result.output.summary,
      findings,
      rawOutput: result.output,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
    };
  } catch (error) {
    return {
      reviewRunId: input.reviewRunId,
      reviewerRole: "minimal-reviewer",
      status: "failed",
      findings: [],
      rawOutput: result.output,
      error: { kind: "invalid-output", message: error instanceof Error ? error.message : String(error), retryable: false },
      startedAt: result.startedAt,
      completedAt: result.completedAt,
    };
  }
}
