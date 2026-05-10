import { resolveRunAgent } from "../agent-backed.ts";
import { normalizeDesignReviewFindings } from "./finding-normalizer.ts";
import { designReviewerOutputSchema } from "./schemas.ts";
import type { BoundDesignArtifact } from "./artifact-binding.ts";
import type { FullDesignReviewerDefinition } from "./full-reviewer-registry.ts";
import type { ReviewerCoordinatorOptions } from "./reviewer-coordinator.ts";
import type { DesignReviewerOutput, DesignReviewerResult } from "./types.ts";
import type { WorkflowState } from "../../types.ts";

export async function runFullDesignReviewer(input: {
  reviewRunId: string;
  reviewer: FullDesignReviewerDefinition;
  artifact: BoundDesignArtifact;
  state: WorkflowState;
  options: ReviewerCoordinatorOptions;
}): Promise<DesignReviewerResult> {
  const run = input.options.runAgent ?? resolveRunAgent(input.options);
  const promptInput = { topic: input.state.topic, designRef: input.artifact.ref, designContent: input.artifact.content };
  const startedAt = new Date().toISOString();

  try {
    const result = await run<DesignReviewerOutput>({
      role: input.reviewer.role,
      purpose: `${input.reviewer.displayName} review of Brainstorming Pro design artifact`,
      prompt: input.reviewer.buildPrompt(promptInput),
      systemPrompt: input.reviewer.buildSystemPrompt(),
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
      outputSchema: designReviewerOutputSchema,
    });

    if (result.status !== "succeeded" || !result.output) {
      return {
        reviewRunId: input.reviewRunId,
        reviewerRole: input.reviewer.role,
        status: "failed",
        findings: [],
        error: result.error ?? { kind: result.status, message: `${input.reviewer.displayName} ${result.status}.`, retryable: result.status === "failed" || result.status === "timed-out" },
        startedAt: result.startedAt ?? startedAt,
        completedAt: result.completedAt ?? new Date().toISOString(),
      };
    }

    try {
      const findings = normalizeDesignReviewFindings({
        reviewRunId: input.reviewRunId,
        designRef: input.artifact.ref,
        reviewerRole: input.reviewer.role,
        findings: result.output.findings,
        topicDir: input.artifact.topicDir,
      });
      return {
        reviewRunId: input.reviewRunId,
        reviewerRole: input.reviewer.role,
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
        reviewerRole: input.reviewer.role,
        status: "failed",
        findings: [],
        rawOutput: result.output,
        error: { kind: "invalid-output", message: error instanceof Error ? error.message : String(error), retryable: false },
        startedAt: result.startedAt,
        completedAt: result.completedAt,
      };
    }
  } catch (error) {
    return {
      reviewRunId: input.reviewRunId,
      reviewerRole: input.reviewer.role,
      status: "failed",
      findings: [],
      error: { kind: "unexpected-error", message: error instanceof Error ? error.message : String(error), retryable: false },
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
}
