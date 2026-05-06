import type { AgentDefinition, BrainstormingProConfig, RefinerOutput, UserDecision, WorkflowError, WorkflowState } from "../types.ts";
import type { RunPaths } from "../artifact-store.ts";
import { loadState, saveState, updateStatePhase, writeJsonArtifact, writeMarkdownArtifact, writeVersionedDesign } from "../artifact-store.ts";
import { RefinerOutputSchema } from "../schemas.ts";
import { buildAgentTaskPrompt } from "../prompts.ts";
import { assertNoBlockingDiscussedIssues } from "../user-gate.ts";
import { runSubagent } from "../runner.ts";

export type RefinePhaseParams = {
  paths: RunPaths;
  state: WorkflowState;
  config: BrainstormingProConfig;
  refiner: AgentDefinition;
  cwd: string;
  currentDesign: string;
  decisions: UserDecision[];
  currentModel?: string;
  availableModels?: string[];
  runRefiner?: typeof runSubagent<RefinerOutput>;
};

export async function runRefinePhase(params: RefinePhaseParams): Promise<WorkflowState> {
  await updateStatePhase(params.paths, "REFINE");
  const accepted = params.decisions.filter((decision) => decision.decision === "accept");
  const preflightState = await loadState(params.paths);
  preflightState.pendingDecisions = preflightState.pendingDecisions.filter((id) => !accepted.some((decision) => decision.issueId === id));
  preflightState.metadata.pendingDecisionIds = preflightState.pendingDecisions;
  await saveState(params.paths, preflightState);
  assertNoBlockingDiscussedIssues(preflightState);
  const rejectedOrDeferred = params.decisions.filter((decision) => decision.decision !== "accept").map((decision) => decision.issueId);
  const prompt = buildAgentTaskPrompt({
    topic: params.state.metadata.topic.displayName,
    phase: "REFINE",
    instructions: [
      "Revise the design using only accepted decisions.",
      "Do not apply rejected, deferred, or needs-discussion issues as current requirements.",
      "Return JSON with revisedDesign, changeLog, and optional noOpJustifications.",
    ].join("\n"),
    schema: JSON.stringify(RefinerOutputSchema, null, 2),
    artifacts: [
      { label: "Current design", path: params.paths.designPath, content: params.currentDesign },
      { label: "Accepted decisions", content: JSON.stringify(accepted, null, 2) },
      { label: "Rejected/deferred issue IDs", content: JSON.stringify(rejectedOrDeferred, null, 2) },
    ],
  });

  const runner = params.runRefiner ?? runSubagent<RefinerOutput>;
  const result = await runner({
    agent: params.refiner,
    cwd: params.cwd,
    prompt,
    config: params.config,
    currentModel: params.currentModel,
    availableModels: params.availableModels,
    expectedSchema: RefinerOutputSchema,
    schemaName: "RefinerOutput",
    artifactPaths: params.paths,
  });

  const state = await loadState(params.paths);
  state.execution.agentRuns += 1;
  if (result.status !== "success" || !result.parsedOutput) {
    state.execution.failedAgentRuns += 1;
    state.phase = "ABORTED";
    state.execution.status = "failed";
    state.errors.push(withPhase(result.error, "REFINE") ?? refineError("Refiner failed without structured error."));
    await saveState(params.paths, state);
    return state;
  }

  const validationError = validateRefinerOutput(result.parsedOutput, accepted.map((decision) => decision.issueId), rejectedOrDeferred);
  if (validationError) {
    state.execution.failedAgentRuns += 1;
    state.phase = "ABORTED";
    state.execution.status = "failed";
    state.errors.push(refineError(validationError));
    await saveState(params.paths, state);
    return state;
  }

  const nextVersion = state.metadata.latestVersion + 1;
  const versioned = await writeVersionedDesign(params.paths, nextVersion, result.parsedOutput.revisedDesign);
  const jsonPath = await writeJsonArtifact(params.paths, `reviews/round-${state.round}/refine.json`, result.parsedOutput);
  const legacyJsonPath = await writeJsonArtifact(params.paths, `refine-r${state.round}-${state.refinementAttempts + 1}.json`, result.parsedOutput);
  const snapshotPath = await writeMarkdownArtifact(params.paths, `design-r${state.round}-refined-${state.refinementAttempts + 1}.md`, result.parsedOutput.revisedDesign);
  const changeLogPath = await writeMarkdownArtifact(params.paths, `reviews/round-${state.round}/refine.md`, renderRefineMarkdown(result.parsedOutput));

  state.refinementAttempts += 1;
  state.metadata.latestVersion = nextVersion;
  state.designVersions ??= [];
  state.designVersions.push({
    version: nextVersion,
    designPath: versioned.versionPath,
    changeSummary: `Refined accepted issues: ${accepted.map((decision) => decision.issueId).join(", ") || "none"}`,
    methodologyVersions: state.metadata.methodologyVersions,
    createdAt: new Date().toISOString(),
  });
  state.acceptedIssueIds = accepted.map((decision) => decision.issueId);
  state.rejectedIssueIds = params.decisions.filter((decision) => decision.decision === "reject").map((decision) => decision.issueId);
  state.deferredIssueIds = params.decisions.filter((decision) => decision.decision === "defer").map((decision) => decision.issueId);
  for (const artifactPath of [params.paths.designPath, versioned.versionPath, jsonPath, legacyJsonPath, snapshotPath, changeLogPath]) {
    if (!state.completedArtifacts.includes(artifactPath)) state.completedArtifacts.push(artifactPath);
  }
  await saveState(params.paths, state);
  return state;
}

export function validateRefinerOutput(output: RefinerOutput, acceptedIssueIds: string[], rejectedOrDeferredIssueIds: string[]): string | undefined {
  const changed = new Set(output.changeLog.map((change) => change.issueId));
  const noOps = new Set((output.noOpJustifications ?? []).map((item) => item.issueId));
  for (const id of acceptedIssueIds) {
    if (!changed.has(id) && !noOps.has(id)) return `Accepted issue ${id} is missing from changeLog and noOpJustifications.`;
  }
  for (const id of rejectedOrDeferredIssueIds) {
    if (changed.has(id)) return `Rejected/deferred issue ${id} appeared in refiner changeLog.`;
  }
  if (!output.revisedDesign.trim()) return "Refiner returned an empty revised design.";
  return undefined;
}

function renderRefineMarkdown(output: RefinerOutput): string {
  const lines = ["# Refinement Change Log", ""];
  for (const change of output.changeLog) lines.push(`- ${change.issueId}: ${change.summary}`);
  for (const noOp of output.noOpJustifications ?? []) lines.push(`- ${noOp.issueId}: no-op — ${noOp.reason}`);
  return lines.join("\n");
}

function refineError(message: string): WorkflowError {
  return { type: "validation", message, phase: "REFINE", recoverable: true, occurredAt: new Date().toISOString() };
}

function withPhase(error: WorkflowError | undefined, phase: WorkflowError["phase"]): WorkflowError | undefined {
  if (!error) return undefined;
  return { ...error, phase };
}
