import { runAgent } from "../../../runtime/agent-execution/run-agent.ts";
import type { AgentProgressEvent, AgentRunResult, ProviderQualifiedModel } from "../../../runtime/agent-execution/types.ts";
import { agentProgressToWorkflowProgress } from "../../progress-adapters.ts";
import type { WorkflowProgressEvent } from "../../progress-types.ts";
import type { VersionedArtifactRef, WorkflowState } from "../../types.ts";
import { planReviewerOutputSchema } from "./schemas.ts";
import { buildPlanReviewerPrompt } from "./prompts/shared.ts";
import { getFixedPlanReviewers } from "./reviewer-registry.ts";
import type { PlanReviewArtifactBinding, PlanReviewerOutput, PlanReviewerRole } from "./types.ts";

export type RunPlanReviewersInput = {
  topic: string;
  workflowRunId: string;
  projectRoot: string;
  topicDir: string;
  model: ProviderQualifiedModel;
  binding: PlanReviewArtifactBinding;
  contents: { design: string; requirements: string; tasks: string };
  artifacts: Partial<Record<"design" | "requirements" | "tasks", VersionedArtifactRef>>;
  state?: WorkflowState;
  piCommand?: string;
  env?: NodeJS.ProcessEnv;
  onWorkflowProgress?: (event: WorkflowProgressEvent) => void | Promise<void>;
};

export type PlanReviewerAgentResult = {
  role: PlanReviewerRole;
  result: AgentRunResult<PlanReviewerOutput>;
};

function planReviewerProgressCallback(input: RunPlanReviewersInput, role: PlanReviewerRole): ((event: AgentProgressEvent) => void | Promise<void>) | undefined {
  if (!input.onWorkflowProgress) return undefined;
  return async (event: AgentProgressEvent): Promise<void> => {
    try {
      await input.onWorkflowProgress?.(agentProgressToWorkflowProgress(event, { topic: input.topic, runId: input.workflowRunId, phase: "plan-review", role }));
    } catch {
      // Progress callbacks are diagnostic-only and must not fail plan review.
    }
  };
}

export async function runFixedPlanReviewers(input: RunPlanReviewersInput): Promise<{ ok: true; results: PlanReviewerAgentResult[] } | { ok: false; results: PlanReviewerAgentResult[]; reason: string }> {
  const reviewers = getFixedPlanReviewers();
  const results = await Promise.all(reviewers.map(async (role) => {
    const prompts = buildPlanReviewerPrompt({ role, binding: input.binding, contents: input.contents });
    const result = await runAgent<PlanReviewerOutput>({
      role,
      purpose: `plan-review:${role}`,
      prompt: prompts.prompt,
      systemPrompt: prompts.systemPrompt,
      model: input.model,
      workflow: { topic: input.topic, runId: input.workflowRunId, phase: "plan-review", projectRoot: input.projectRoot, topicDir: input.topicDir, artifacts: input.artifacts, state: input.state },
      outputSchema: planReviewerOutputSchema,
      limits: { maxRetries: 0 },
      piCommand: input.piCommand,
      env: input.env,
      onProgress: planReviewerProgressCallback(input, role),
    });
    return { role, result };
  }));

  const failed = results.find((entry) => entry.result.status !== "succeeded" || !entry.result.output);
  if (failed) return { ok: false, results, reason: `${failed.role} ${failed.result.status}` };
  return { ok: true, results };
}
