import fs from "node:fs/promises";
import type { WorkflowLayout } from "./artifact-store.ts";
import { checksum, resolveWorkflowPath } from "./artifact-store.ts";
import type { ReviewTarget, VersionedArtifactRef } from "./types.ts";

export type ReviewValidationResult =
  | { status: "passed"; target: ReviewTarget; artifacts: VersionedArtifactRef[] }
  | { status: "blocked"; target: ReviewTarget; artifacts: VersionedArtifactRef[]; reason: string }
  | { status: "failed"; target: ReviewTarget; artifacts: VersionedArtifactRef[]; reason: string };

export async function validateReviewReadiness(layout: WorkflowLayout, target: ReviewTarget, artifacts: VersionedArtifactRef[]): Promise<ReviewValidationResult> {
  if (artifacts.length === 0) return { status: "blocked", target, artifacts, reason: "No artifacts were selected for review." };
  try {
    for (const artifact of artifacts) {
      const artifactPath = resolveWorkflowPath(layout, artifact.path);
      const content = await fs.readFile(artifactPath, "utf8");
      if (!content.trim()) return { status: "blocked", target, artifacts, reason: `${artifact.kind} artifact is empty.` };
      if (checksum(content) !== artifact.checksum) return { status: "failed", target, artifacts, reason: `${artifact.kind} artifact checksum mismatch.` };
    }
    return { status: "passed", target, artifacts };
  } catch (error) {
    return { status: "blocked", target, artifacts, reason: error instanceof Error ? error.message : String(error) };
  }
}
