import type { StaleEvidenceViewModel } from "../review-panel-view-model.ts";
import { artifactLabel } from "../review-panel-view-model.ts";

export function renderStaleEvidenceView(items: StaleEvidenceViewModel[]): string[] {
  if (!items.length) return [];
  const lines = ["Old review evidence is provenance only.", "It cannot approve the current design artifact."];
  for (const item of items) {
    lines.push(`${item.kind}: ${item.reason}`);
    if (item.currentArtifactRefs?.length) lines.push(`  Current: ${item.currentArtifactRefs.map(artifactLabel).join(", ")}`);
    if (item.staleArtifactRefs?.length) lines.push(`  Stale: ${item.staleArtifactRefs.map(artifactLabel).join(", ")}`);
    if (item.checksumMismatch || item.artifactMismatch) lines.push("  Warning: checksum or artifact mismatch; evidence is not current readiness.");
  }
  return lines;
}
