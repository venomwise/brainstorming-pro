import type { RunPaths } from "../artifact-store.ts";
import { loadState, saveState, writeJsonArtifact, writeMarkdownArtifact, writeVersionedDesign } from "../artifact-store.ts";
import type { WorkflowState } from "../types.ts";

export type RevisionClassification = "wording-detail" | "clarification" | "scope-approach" | "review-worthy-major";

export type ConversationalRevision = {
  feedback: string;
  classification: RevisionClassification;
  revisedDesign?: string;
  changeSummary?: string;
  reviewRecommendationReason?: string;
};

export async function runConversationalRevisionPhase(params: {
  paths: RunPaths;
  revision: ConversationalRevision;
}): Promise<WorkflowState> {
  const state = await loadState(params.paths);
  state.phase = "CONVERSATIONAL_REVISION";
  state.metadata.currentPhase = "CONVERSATIONAL_REVISION";

  const currentVersion = state.metadata.latestVersion;
  const nextVersion = params.revision.revisedDesign && params.revision.revisedDesign.trim()
    ? currentVersion + 1
    : currentVersion;

  const revisionMarkdown = renderRevisionMarkdown(params.revision, currentVersion, nextVersion);
  const revisionPath = await writeMarkdownArtifact(params.paths, `versions/v${nextVersion}/revision.md`, revisionMarkdown);
  const revisionJsonPath = await writeJsonArtifact(params.paths, `versions/v${nextVersion}/revision.json`, {
    ...params.revision,
    fromVersion: currentVersion,
    toVersion: nextVersion,
    changedDesign: nextVersion !== currentVersion,
    createdAt: new Date().toISOString(),
  });

  if (params.revision.revisedDesign && nextVersion !== currentVersion) {
    const versioned = await writeVersionedDesign(params.paths, nextVersion, params.revision.revisedDesign);
    state.metadata.latestVersion = nextVersion;
    state.designVersions ??= [];
    state.designVersions.push({
      version: nextVersion,
      designPath: versioned.versionPath,
      revisionPath,
      changeSummary: params.revision.changeSummary ?? params.revision.classification,
      methodologyVersions: state.metadata.methodologyVersions,
      createdAt: new Date().toISOString(),
    });
    if (!state.completedArtifacts.includes(versioned.versionPath)) state.completedArtifacts.push(versioned.versionPath);
  }

  for (const artifactPath of [revisionPath, revisionJsonPath]) if (!state.completedArtifacts.includes(artifactPath)) state.completedArtifacts.push(artifactPath);
  state.phase = "DESIGN_REVIEW_GATE";
  state.metadata.currentPhase = "DESIGN_REVIEW_GATE";
  state.metadata.resumeStatus = "awaiting-design-gate-decision";
  if (params.revision.classification === "review-worthy-major" || params.revision.classification === "scope-approach") {
    state.metadata.resumeHint = `Resume with /clarify --resume; cross-review recommended: ${params.revision.reviewRecommendationReason ?? params.revision.classification}`;
  }
  await saveState(params.paths, state);
  return state;
}

function renderRevisionMarkdown(revision: ConversationalRevision, fromVersion: number, toVersion: number): string {
  return [
    "# Conversational Revision",
    "",
    `From version: v${fromVersion}`,
    `To version: v${toVersion}`,
    `Classification: ${revision.classification}`,
    revision.changeSummary ? `Change summary: ${revision.changeSummary}` : undefined,
    revision.reviewRecommendationReason ? `Cross-review recommendation: ${revision.reviewRecommendationReason}` : undefined,
    "",
    "## Feedback",
    "",
    revision.feedback,
    "",
  ].filter((line): line is string => line !== undefined).join("\n");
}
