import type { AgentDefinition, BrainstormingProConfig, DesignerOutput, WorkflowError, WorkflowState } from "../types.ts";
import type { RunPaths } from "../artifact-store.ts";
import { recordCompletedArtifact, saveState, updateStatePhase, writeDesignFile, writeJsonArtifact, writeMarkdownArtifact } from "../artifact-store.ts";
import { DesignerOutputSchema } from "../schemas.ts";
import { buildAgentTaskPrompt } from "../prompts.ts";
import { runSubagent } from "../runner.ts";

export type DiscoveryPhaseParams = {
  paths: RunPaths;
  state: WorkflowState;
  config: BrainstormingProConfig;
  designer: AgentDefinition;
  cwd: string;
  packageRoot?: string;
  currentModel?: string;
  availableModels?: string[];
  runDesigner?: typeof runSubagent<DesignerOutput>;
};

export async function runDiscoveryPhase(params: DiscoveryPhaseParams): Promise<WorkflowState> {
  await updateStatePhase(params.paths, "DISCOVERY");
  const prompt = buildAgentTaskPrompt({
    topic: params.state.metadata.topic.displayName,
    phase: "DISCOVERY",
    instructions: [
      "Perform discovery for the requested topic and produce an initial design.",
      "Return JSON with discoveryMarkdown and designMarkdown fields.",
      "The design must be a complete markdown document suitable for review.",
    ].join("\n"),
    schema: JSON.stringify(DesignerOutputSchema, null, 2),
  });

  const runner = params.runDesigner ?? runSubagent<DesignerOutput>;
  const result = await runner({
    agent: params.designer,
    cwd: params.cwd,
    prompt,
    config: params.config,
    currentModel: params.currentModel,
    availableModels: params.availableModels,
    expectedSchema: DesignerOutputSchema,
    schemaName: "DesignerOutput",
    artifactPaths: params.paths,
  });

  const state = await loadStateForMutation(params.paths);
  state.execution.agentRuns += 1;
  if (result.status !== "success" || !result.parsedOutput) {
    state.execution.failedAgentRuns += 1;
    const error: WorkflowError = result.error ?? {
      type: "subagent",
      message: "Designer failed without structured error.",
      phase: "DISCOVERY",
      recoverable: false,
      occurredAt: new Date().toISOString(),
    };
    error.phase = "DISCOVERY";
    error.recoverable = false;
    state.errors.push(error);
    state.phase = "ABORTED";
    state.execution.status = "failed";
    await saveState(params.paths, state);
    return state;
  }

  await writeDesignFile(params.paths, result.parsedOutput.designMarkdown);
  await recordCompletedArtifact(params.paths, params.paths.designPath);

  const discoveryPath = await writeMarkdownArtifact(params.paths, "01-discovery.md", result.parsedOutput.discoveryMarkdown);
  const designSnapshotPath = await writeMarkdownArtifact(params.paths, "02-design-v1.md", result.parsedOutput.designMarkdown);
  const jsonPath = await writeJsonArtifact(params.paths, "01-discovery.json", result.parsedOutput);

  const updated = await loadStateForMutation(params.paths);
  for (const artifactPath of [discoveryPath, designSnapshotPath, jsonPath]) {
    if (!updated.completedArtifacts.includes(artifactPath)) updated.completedArtifacts.push(artifactPath);
  }
  if (!updated.completedArtifacts.includes(params.paths.designPath)) updated.completedArtifacts.push(params.paths.designPath);
  updated.phase = "INITIAL_DESIGN";
  await saveState(params.paths, updated);
  return updated;
}

async function loadStateForMutation(paths: RunPaths): Promise<WorkflowState> {
  const { loadState } = await import("../artifact-store.ts");
  return loadState(paths);
}
