import { resolveRunAgent, type AgentBackedAdapterOptions, type RunAgentFunction } from "../agent-backed.ts";
import { buildMinimalDesignReviewPrompt, buildMinimalDesignReviewSystemPrompt } from "./prompts/minimal-review.ts";
import { minimalDesignReviewOutputSchema } from "./schemas.ts";
import { normalizeDesignReviewFindings } from "./finding-normalizer.ts";
import type { BoundDesignArtifact } from "./artifact-binding.ts";
import type { DesignReviewerResult, DesignReviewerRole, MinimalDesignReviewOutput } from "./types.ts";
import type { WorkflowState } from "../../types.ts";

export type ReviewerCoordinatorOptions = Pick<AgentBackedAdapterOptions, "projectRoot" | "model"> & {
  runAgent?: RunAgentFunction;
};

export function resolveFullDesignReviewerSet(): Exclude<DesignReviewerRole, "minimal-reviewer">[] | undefined {
  return undefined;
}

export async function runDesignReviewers(input: {
  mode: "minimal" | "full";
  reviewRunId: string;
  artifact: BoundDesignArtifact;
  state: WorkflowState;
  options: ReviewerCoordinatorOptions;
}): Promise<DesignReviewerResult[]> {
  if (input.mode === "full") throw new Error("Full design reviewer role pack is not registered.");
  return [await runMinimalDesignReviewer(input)];
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
