import type { AgentDefinition, AgentRunResult, BrainstormingProConfig, ReviewerOutput, WorkflowError, WorkflowState } from "../types.ts";
import type { RunPaths } from "../artifact-store.ts";
import { loadState, saveState, updateStatePhase, writeJsonArtifact, writeMarkdownArtifact } from "../artifact-store.ts";
import { ReviewerOutputSchema } from "../schemas.ts";
import { buildAgentTaskPrompt } from "../prompts.ts";
import { runBounded } from "../concurrency.ts";
import { runSubagent } from "../runner.ts";

export type ReviewPhaseParams = {
  paths: RunPaths;
  state: WorkflowState;
  config: BrainstormingProConfig;
  reviewers: AgentDefinition[];
  cwd: string;
  currentDesign: string;
  currentModel?: string;
  availableModels?: string[];
  runReviewer?: typeof runSubagent<ReviewerOutput>;
};

export type ReviewArtifact = {
  reviewer: string;
  status: AgentRunResult<ReviewerOutput>["status"];
  issues: ReviewerOutput["issues"];
  summary?: string;
  error?: WorkflowError;
};

export async function runReviewPhase(params: ReviewPhaseParams): Promise<WorkflowState> {
  await updateStatePhase(params.paths, "REVIEW");
  const runner = params.runReviewer ?? runSubagent<ReviewerOutput>;
  const results = await runBounded(params.reviewers, params.config.reviewers.concurrency, async (reviewer) => {
    const prompt = buildAgentTaskPrompt({
      topic: params.state.metadata.topic.displayName,
      phase: "REVIEW",
      instructions: [
        `Review the current design as ${reviewer.name}.`,
        "Do not rewrite the design. Return independent structured findings only.",
        "Return JSON with reviewer, issues, and optional summary.",
      ].join("\n"),
      schema: JSON.stringify(ReviewerOutputSchema, null, 2),
      artifacts: [{ label: "Current design.md", path: params.paths.designPath, content: params.currentDesign }],
    });

    return runner({
      agent: reviewer,
      cwd: params.cwd,
      prompt,
      config: params.config,
      currentModel: params.currentModel,
      availableModels: params.availableModels,
      expectedSchema: ReviewerOutputSchema,
      schemaName: "ReviewerOutput",
      artifactPaths: params.paths,
    });
  });

  const artifacts: ReviewArtifact[] = results.map((result) => ({
    reviewer: result.agentName,
    status: result.status,
    issues: result.parsedOutput?.issues ?? [],
    summary: result.parsedOutput?.summary,
    error: result.error,
  }));

  const successful = artifacts.filter((artifact) => artifact.status === "success");
  const successRatio = params.reviewers.length === 0 ? 1 : successful.length / params.reviewers.length;
  const jsonPath = await writeJsonArtifact(params.paths, `review-r${params.state.round}.json`, { reviewers: artifacts });
  const markdownPath = await writeMarkdownArtifact(params.paths, `review-r${params.state.round}.md`, renderReviewMarkdown(artifacts));

  const state = await loadState(params.paths);
  state.execution.agentRuns += results.length;
  state.execution.failedAgentRuns += results.filter((result) => result.status !== "success").length;
  state.reviewers = artifacts.map((artifact) => ({
    name: artifact.reviewer,
    status: artifact.status === "success" ? "complete" : "failed",
    issueCount: artifact.issues.length,
    error: artifact.error,
  }));
  for (const artifactPath of [jsonPath, markdownPath]) {
    if (!state.completedArtifacts.includes(artifactPath)) state.completedArtifacts.push(artifactPath);
  }

  if (successRatio < 0.5) {
    state.phase = "ABORTED";
    state.execution.status = "failed";
    state.errors.push({
      type: "subagent",
      message: `Review phase failed success-ratio policy: ${successful.length}/${params.reviewers.length} reviewers succeeded.`,
      phase: "REVIEW",
      recoverable: true,
      occurredAt: new Date().toISOString(),
    });
  }

  await saveState(params.paths, state);
  return state;
}

function renderReviewMarkdown(artifacts: ReviewArtifact[]): string {
  const lines = ["# Review Findings", ""];
  for (const artifact of artifacts) {
    lines.push(`## ${artifact.reviewer}`, "", `Status: ${artifact.status}`, "", artifact.summary ?? "", "");
    for (const issue of artifact.issues) {
      lines.push(`- **${issue.severity} ${issue.id || issue.title}**: ${issue.title}`, `  - ${issue.description}`, `  - Suggested change: ${issue.suggestedChange}`);
    }
    if (artifact.error) lines.push(`Error: ${artifact.error.message}`);
    lines.push("");
  }
  return lines.join("\n");
}
