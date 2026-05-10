import fs from "node:fs/promises";
import type { WorkflowLayout } from "../../artifact-store.ts";
import { checksum, resolveWorkflowPath } from "../../artifact-store.ts";
import type { ReviewDecisionRef, VersionedArtifactRef, WorkflowState } from "../../types.ts";

export type BoundDesignArtifact = {
  ref: VersionedArtifactRef;
  content: string;
  absolutePath: string;
  topicDir: string;
};

export async function bindDesignArtifactForReview(layout: WorkflowLayout, state: WorkflowState, decision: ReviewDecisionRef): Promise<BoundDesignArtifact> {
  assertDesignReviewDecisionFresh(state, decision);
  const ref = state.artifacts.design;
  if (!ref) throw new Error("No latest design artifact is recorded in workflow state.");
  const absolutePath = resolveWorkflowPath(layout, ref.path);
  const content = await fs.readFile(absolutePath, "utf8");
  if (!content.trim()) throw new Error("Design artifact is empty.");
  if (checksum(content) !== ref.checksum) throw new Error("Design artifact checksum mismatch.");
  return { ref, content, absolutePath, topicDir: layout.topicDir };
}

export function assertDesignReviewDecisionFresh(state: WorkflowState, decision: ReviewDecisionRef): void {
  if (decision.target !== "design") throw new Error("Review decision target must be design.");
  const latest = state.artifacts.design;
  if (!latest) throw new Error("No latest design artifact is recorded in workflow state.");
  const selected = decision.artifacts.find((artifact) => artifact.kind === "design");
  if (!selected) throw new Error("Design review decision does not reference a design artifact.");
  if (!sameArtifactRef(latest, selected)) throw new Error("Stale design review decision: selected design artifact no longer matches latest design artifact.");
}

function sameArtifactRef(a: VersionedArtifactRef, b: VersionedArtifactRef): boolean {
  return a.kind === b.kind && a.version === b.version && a.path === b.path && a.checksum === b.checksum;
}
