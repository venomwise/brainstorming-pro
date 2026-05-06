import type { AgentDefinition, BrainstormingProConfig, DesignerOutput, WorkflowError, WorkflowState } from "../types.ts";
import type { RunPaths } from "../artifact-store.ts";
import { recordCompletedArtifact, saveState, updateStatePhase, writeJsonArtifact, writeMarkdownArtifact, writeVersionedDesign } from "../artifact-store.ts";
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

  const versioned = await writeVersionedDesign(params.paths, 0, result.parsedOutput.designMarkdown);
  await recordCompletedArtifact(params.paths, params.paths.designPath);

  const discoveryPath = await writeMarkdownArtifact(params.paths, "versions/v0/discovery.md", result.parsedOutput.discoveryMarkdown);
  const legacyDiscoveryPath = await writeMarkdownArtifact(params.paths, "01-discovery.md", result.parsedOutput.discoveryMarkdown);
  const legacyDesignSnapshotPath = await writeMarkdownArtifact(params.paths, "02-design-v1.md", result.parsedOutput.designMarkdown);
  const jsonPath = await writeJsonArtifact(params.paths, "versions/v0/discovery.json", {
    ...result.parsedOutput,
    requestSummary: params.state.metadata.requestSummary,
    assumptions: extractSection(result.parsedOutput.discoveryMarkdown, "assumptions"),
    blindSpots: extractSection(result.parsedOutput.discoveryMarkdown, "blind spots"),
    methodologyVersions: params.state.metadata.methodologyVersions,
  });

  const updated = await loadStateForMutation(params.paths);
  for (const artifactPath of [discoveryPath, legacyDiscoveryPath, legacyDesignSnapshotPath, versioned.versionPath, jsonPath]) {
    if (!updated.completedArtifacts.includes(artifactPath)) updated.completedArtifacts.push(artifactPath);
  }
  if (!updated.completedArtifacts.includes(params.paths.designPath)) updated.completedArtifacts.push(params.paths.designPath);
  updated.phase = "DESIGN_REVIEW_GATE";
  updated.metadata.currentPhase = "DESIGN_REVIEW_GATE";
  updated.metadata.resumeStatus = "awaiting-design-gate-decision";
  updated.metadata.latestVersion = Math.max(updated.metadata.latestVersion, 0);
  updated.metadata.methodologyVersions = params.state.metadata.methodologyVersions;
  updated.designVersions ??= [];
  if (!updated.designVersions.some((item) => item.version === 0)) {
    updated.designVersions.push({
      version: 0,
      designPath: versioned.versionPath,
      discoveryPath,
      changeSummary: "Initial V0 brainstorming design.",
      methodologyVersions: updated.metadata.methodologyVersions,
      createdAt: new Date().toISOString(),
    });
  }
  await saveState(params.paths, updated);
  return updated;
}

function extractSection(markdown: string, title: string): string[] {
  const lines = markdown.split(/\r?\n/u);
  const start = lines.findIndex((line) => new RegExp(`^#{1,6}\\s+${title}`, "iu").test(line));
  if (start === -1) return [];
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/u.test(line)) break;
    const trimmed = line.replace(/^[-*]\s*/u, "").trim();
    if (trimmed) body.push(trimmed);
  }
  return body;
}

async function loadStateForMutation(paths: RunPaths): Promise<WorkflowState> {
  const { loadState } = await import("../artifact-store.ts");
  return loadState(paths);
}
