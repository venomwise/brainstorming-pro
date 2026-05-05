import type { AgentDefinition, BrainstormingProConfig, DesignIssue, TriageOutput, WorkflowError, WorkflowState } from "../types.ts";
import type { RunPaths } from "../artifact-store.ts";
import { loadState, saveState, updateStatePhase, writeJsonArtifact, writeMarkdownArtifact } from "../artifact-store.ts";
import { TriageOutputSchema } from "../schemas.ts";
import { buildAgentTaskPrompt } from "../prompts.ts";
import { assertIssueReferencesValid, canonicalizeIssues } from "../issues.ts";
import { runSubagent } from "../runner.ts";
import type { ReviewArtifact } from "./review.ts";

export type TriagePhaseParams = {
  paths: RunPaths;
  state: WorkflowState;
  config: BrainstormingProConfig;
  triager: AgentDefinition;
  cwd: string;
  reviewArtifacts: ReviewArtifact[];
  currentModel?: string;
  availableModels?: string[];
  runTriager?: typeof runSubagent<TriageOutput>;
};

export async function runTriagePhase(params: TriagePhaseParams): Promise<WorkflowState> {
  await updateStatePhase(params.paths, "TRIAGE");
  const prompt = buildAgentTaskPrompt({
    topic: params.state.metadata.topic.displayName,
    phase: "TRIAGE",
    instructions: [
      "Deduplicate reviewer findings into canonical issues.",
      "Assign severity, cost, confidence, recommendation, dependencies/conflicts, and concrete evidence.",
      "Return JSON with issues and optional summary.",
    ].join("\n"),
    schema: JSON.stringify(TriageOutputSchema, null, 2),
    artifacts: [{ label: "Reviewer findings", content: JSON.stringify(params.reviewArtifacts, null, 2) }],
  });

  const runner = params.runTriager ?? runSubagent<TriageOutput>;
  const result = await runner({
    agent: params.triager,
    cwd: params.cwd,
    prompt,
    config: params.config,
    currentModel: params.currentModel,
    availableModels: params.availableModels,
    expectedSchema: TriageOutputSchema,
    schemaName: "TriageOutput",
    artifactPaths: params.paths,
  });

  const state = await loadState(params.paths);
  state.execution.agentRuns += 1;
  if (result.status !== "success" || !result.parsedOutput) {
    state.execution.failedAgentRuns += 1;
    state.phase = "ABORTED";
    state.execution.status = "failed";
    state.errors.push(withPhase(result.error, "TRIAGE") ?? triageError("Triager failed without structured error."));
    await saveState(params.paths, state);
    return state;
  }

  let issues: DesignIssue[];
  try {
    issues = canonicalizeIssues(result.parsedOutput.issues, state.round);
    assertIssueReferencesValid(issues);
  } catch (error) {
    state.execution.failedAgentRuns += 1;
    state.phase = "ABORTED";
    state.execution.status = "failed";
    state.errors.push(triageError(error instanceof Error ? error.message : String(error)));
    await saveState(params.paths, state);
    return state;
  }

  const output: TriageOutput = { ...result.parsedOutput, issues };
  const jsonPath = await writeJsonArtifact(params.paths, `triage-r${state.round}.json`, output);
  const markdownPath = await writeMarkdownArtifact(params.paths, `triage-r${state.round}.md`, renderTriageMarkdown(output));
  for (const artifactPath of [jsonPath, markdownPath]) {
    if (!state.completedArtifacts.includes(artifactPath)) state.completedArtifacts.push(artifactPath);
  }
  state.pendingDecisions = issues.map((issue) => issue.id);
  await saveState(params.paths, state);
  return state;
}

function renderTriageMarkdown(output: TriageOutput): string {
  const lines = ["# Triage", "", output.summary ?? "", ""];
  for (const issue of output.issues) {
    lines.push(`## ${issue.id}: ${issue.title}`, "", `Severity: ${issue.severity}`, `Recommendation: ${issue.recommendation}`, "", issue.description, "", `Suggested change: ${issue.suggestedChange}`, "");
  }
  return lines.join("\n");
}

function triageError(message: string): WorkflowError {
  return { type: "validation", message, phase: "TRIAGE", recoverable: true, occurredAt: new Date().toISOString() };
}

function withPhase(error: WorkflowError | undefined, phase: WorkflowError["phase"]): WorkflowError | undefined {
  if (!error) return undefined;
  return { ...error, phase };
}
