import type { AgentDefinition, BrainstormingProConfig, UserDecision, VerificationResult, WorkflowError, WorkflowState } from "../types.ts";
import type { RunPaths } from "../artifact-store.ts";
import { loadState, saveState, updateStatePhase, writeJsonArtifact, writeMarkdownArtifact } from "../artifact-store.ts";
import { VerificationResultSchema } from "../schemas.ts";
import { Type } from "typebox";
import { buildAgentTaskPrompt } from "../prompts.ts";
import { runSubagent } from "../runner.ts";

export const VerifierOutputSchema = Type.Object({
  results: Type.Array(VerificationResultSchema),
  summary: Type.Optional(Type.String()),
});

export type VerifierOutput = {
  results: VerificationResult[];
  summary?: string;
};

export type VerifyPhaseParams = {
  paths: RunPaths;
  state: WorkflowState;
  config: BrainstormingProConfig;
  verifier: AgentDefinition;
  cwd: string;
  refinedDesign: string;
  decisions: UserDecision[];
  currentModel?: string;
  availableModels?: string[];
  runVerifier?: typeof runSubagent<VerifierOutput>;
};

export async function runVerifyPhase(params: VerifyPhaseParams): Promise<WorkflowState> {
  await updateStatePhase(params.paths, "VERIFY");
  const accepted = params.decisions.filter((decision) => decision.decision === "accept");
  const prompt = buildAgentTaskPrompt({
    topic: params.state.metadata.topic.displayName,
    phase: "VERIFY",
    instructions: [
      "Verify that every accepted issue is represented in the refined design.",
      "Classify each issue as completed, partially-completed, missing, or over-implemented.",
      "Return JSON with results and optional summary.",
    ].join("\n"),
    schema: JSON.stringify(VerifierOutputSchema, null, 2),
    artifacts: [
      { label: "Refined design", path: params.paths.designPath, content: params.refinedDesign },
      { label: "Accepted decisions", content: JSON.stringify(accepted, null, 2) },
    ],
  });

  const runner = params.runVerifier ?? runSubagent<VerifierOutput>;
  const result = await runner({
    agent: params.verifier,
    cwd: params.cwd,
    prompt,
    config: params.config,
    currentModel: params.currentModel,
    availableModels: params.availableModels,
    expectedSchema: VerifierOutputSchema,
    schemaName: "VerifierOutput",
    artifactPaths: params.paths,
  });

  const state = await loadState(params.paths);
  state.execution.agentRuns += 1;
  if (result.status !== "success" || !result.parsedOutput) {
    state.execution.failedAgentRuns += 1;
    state.phase = "ABORTED";
    state.execution.status = "failed";
    state.errors.push(withPhase(result.error, "VERIFY") ?? verifyError("Verifier failed without structured error."));
    await saveState(params.paths, state);
    return state;
  }

  const coverageError = validateVerificationCoverage(result.parsedOutput.results, accepted.map((decision) => decision.issueId));
  if (coverageError) {
    state.execution.failedAgentRuns += 1;
    state.phase = "ABORTED";
    state.execution.status = "failed";
    state.errors.push(verifyError(coverageError));
    await saveState(params.paths, state);
    return state;
  }

  const unresolvedP0P1 = result.parsedOutput.results
    .filter((item) => item.status === "missing" || item.status === "partially-completed")
    .map((item) => item.issueId);
  const jsonPath = await writeJsonArtifact(params.paths, `verification-r${state.round}-${state.refinementAttempts}.json`, result.parsedOutput);
  const markdownPath = await writeMarkdownArtifact(params.paths, `verification-r${state.round}-${state.refinementAttempts}.md`, renderVerificationMarkdown(result.parsedOutput));
  state.verification = {
    verified: unresolvedP0P1.length === 0,
    results: result.parsedOutput.results,
    unresolvedP0P1,
  };
  for (const artifactPath of [jsonPath, markdownPath]) {
    if (!state.completedArtifacts.includes(artifactPath)) state.completedArtifacts.push(artifactPath);
  }
  await saveState(params.paths, state);
  return state;
}

export function validateVerificationCoverage(results: VerificationResult[], acceptedIssueIds: string[]): string | undefined {
  const seen = new Set(results.map((result) => result.issueId));
  for (const id of acceptedIssueIds) {
    if (!seen.has(id)) return `Verifier result missing accepted issue ${id}.`;
  }
  for (const result of results) {
    if (!acceptedIssueIds.includes(result.issueId)) return `Verifier returned result for unaccepted issue ${result.issueId}.`;
    if (!result.evidence.trim()) return `Verifier result for ${result.issueId} has empty evidence.`;
  }
  return undefined;
}

function renderVerificationMarkdown(output: VerifierOutput): string {
  const lines = ["# Verification", "", output.summary ?? "", ""];
  for (const result of output.results) lines.push(`- ${result.issueId}: ${result.status} — ${result.evidence}`);
  return lines.join("\n");
}

function verifyError(message: string): WorkflowError {
  return { type: "validation", message, phase: "VERIFY", recoverable: true, occurredAt: new Date().toISOString() };
}

function withPhase(error: WorkflowError | undefined, phase: WorkflowError["phase"]): WorkflowError | undefined {
  if (!error) return undefined;
  return { ...error, phase };
}
