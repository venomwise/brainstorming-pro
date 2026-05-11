import { writeVersionedArtifact, type WorkflowLayout } from "../../artifact-store.ts";
import type { VersionedArtifactRef } from "../../types.ts";

export async function commitRevisedDesignArtifact(layout: WorkflowLayout, markdown: string, date = new Date()): Promise<VersionedArtifactRef> {
  return await writeVersionedArtifact(layout, "design", markdown, date);
}
