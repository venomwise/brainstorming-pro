import path from "node:path";
import fs from "node:fs/promises";
import { checksum, createWorkflowLayout, resolveWorkflowPath, type WorkflowLayout } from "../artifact-store.ts";
import { getWorkflowRuntimePaths } from "../runtime.ts";
import type { ApprovalRef, VersionedArtifactRef, WorkflowState } from "../types.ts";

export type LoadedArtifact = {
  ref: VersionedArtifactRef;
  content: string;
};

export type BrainstormingAdapterContext = {
  topic: string;
  runId: string;
  request: string;
  projectRoot: string;
  topicDir: string;
  workflow: WorkflowState;
  existingDesign?: LoadedArtifact;
};

export type SpecPlanAdapterContext = {
  topic: string;
  runId: string;
  projectRoot: string;
  topicDir: string;
  workflow: WorkflowState;
  approvedDesign: LoadedArtifact;
  designApproval: ApprovalRef;
};

export async function buildBrainstormingAdapterContext(projectRoot: string, state: WorkflowState): Promise<BrainstormingAdapterContext> {
  const paths = getWorkflowRuntimePaths(projectRoot, state.topic, state.runId);
  const layout = await createWorkflowLayout(projectRoot, state.topic);
  const existingDesign = state.artifacts.design ? await loadVerifiedArtifact(layout, state.artifacts.design, "design") : undefined;
  return {
    topic: state.topic,
    runId: state.runId,
    request: state.request,
    projectRoot: path.resolve(projectRoot),
    topicDir: paths.topicDir,
    workflow: state,
    ...(existingDesign ? { existingDesign } : {}),
  };
}

export async function buildSpecPlanAdapterContext(projectRoot: string, state: WorkflowState): Promise<SpecPlanAdapterContext> {
  const paths = getWorkflowRuntimePaths(projectRoot, state.topic, state.runId);
  const layout = await createWorkflowLayout(projectRoot, state.topic);
  const design = state.artifacts.design;
  if (!design) throw new Error("Planning requires a design artifact.");
  const approval = state.gates.design;
  if (!approval) throw new Error("Planning requires design approval.");
  if (!approval.artifacts.some((artifact) => artifactRefsEqual(artifact, design))) {
    throw new Error("Design approval must reference the latest design artifact exactly.");
  }
  const reviewDecision = state.reviewDecisions.design;
  const reviewStatus = state.reviewStatus.design;
  const decisionMatches = reviewDecision?.artifacts.some((artifact) => artifactRefsEqual(artifact, design)) ?? false;
  const skippedStatusMatches = reviewStatus?.status === "skipped" && reviewStatus.artifacts.some((artifact) => artifactRefsEqual(artifact, design));
  if (!decisionMatches && !skippedStatusMatches) {
    throw new Error("Planning requires a review decision or skipped review status for the latest design artifact.");
  }

  return {
    topic: state.topic,
    runId: state.runId,
    projectRoot: path.resolve(projectRoot),
    topicDir: paths.topicDir,
    workflow: state,
    approvedDesign: await loadVerifiedArtifact(layout, design, "design"),
    designApproval: approval,
  };
}

export async function loadVerifiedArtifact(layout: WorkflowLayout, ref: VersionedArtifactRef, expectedKind = ref.kind): Promise<LoadedArtifact> {
  if (ref.kind !== expectedKind) throw new Error(`Expected ${expectedKind} artifact but received ${ref.kind}.`);
  const resolved = resolveWorkflowPath(layout, ref.path);
  const content = await fs.readFile(resolved, "utf8");
  const actual = checksum(content);
  if (actual !== ref.checksum) throw new Error(`Checksum mismatch for ${ref.kind} v${ref.version}.`);
  return { ref, content };
}

function artifactRefsEqual(left: VersionedArtifactRef, right: VersionedArtifactRef): boolean {
  return left.kind === right.kind
    && left.version === right.version
    && left.path === right.path
    && left.checksum === right.checksum;
}
