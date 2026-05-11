import fs from "node:fs/promises";
import { checksum, resolveWorkflowPath, type WorkflowLayout } from "../../artifact-store.ts";
import type { VersionedArtifactRef } from "../../types.ts";

export type StaleDesignReviewProvenance = {
  staleSourceDesignRef: VersionedArtifactRef;
  revisedDesignRef: VersionedArtifactRef;
  sourceReviewRunId: string;
  invalidatedAt: string;
  reason: "superseded-by-design-revision";
};

export function markSourceReviewEvidenceStale(input: { staleSourceDesignRef: VersionedArtifactRef; revisedDesignRef: VersionedArtifactRef; sourceReviewRunId: string; invalidatedAt?: string }): StaleDesignReviewProvenance {
  return {
    staleSourceDesignRef: input.staleSourceDesignRef,
    revisedDesignRef: input.revisedDesignRef,
    sourceReviewRunId: input.sourceReviewRunId,
    invalidatedAt: input.invalidatedAt ?? new Date().toISOString(),
    reason: "superseded-by-design-revision",
  };
}

export async function assertDesignApprovalUsesLatestDesign(layout: WorkflowLayout, designRef: VersionedArtifactRef): Promise<void> {
  if (designRef.kind !== "design") throw new Error("Design approval staleness check requires a design artifact ref.");
  const artifactContent = await fs.readFile(resolveWorkflowPath(layout, designRef.path), "utf8");
  if (checksum(artifactContent) !== designRef.checksum) throw new Error("Design approval artifact checksum mismatch.");
  const mirrorContent = await fs.readFile(resolveWorkflowPath(layout, "design.md"), "utf8");
  if (checksum(mirrorContent) !== designRef.checksum) throw new Error("Design approval evidence is stale for the latest design artifact.");
}
