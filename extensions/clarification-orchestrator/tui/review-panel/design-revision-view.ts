import type { DesignRevisionPanelViewModel } from "../review-panel-view-model.ts";
import { artifactLabel } from "../review-panel-view-model.ts";

export function renderDesignRevisionView(view: DesignRevisionPanelViewModel): string[] {
  const lines: string[] = [];
  lines.push(`Current design: ${artifactLabel(view.currentDesignRef)}`);
  if (view.latestRevision) {
    const revision = view.latestRevision;
    lines.push(`Latest revision ${revision.revisionId}: ${revision.status}`);
    lines.push(`Source design: ${artifactLabel(revision.sourceDesignRef)}`);
    if (revision.revisedDesignRef) lines.push(`Revised design: ${artifactLabel(revision.revisedDesignRef)}`);
    if (revision.sourceReviewRunId) lines.push(`Source review run: ${revision.sourceReviewRunId}`);
    if (revision.sourceTriageLink) lines.push(`Source triage: ${revision.sourceTriageLink.path ?? revision.sourceTriageLink.ref ?? revision.sourceTriageLink.label}`);
    if (revision.postRevisionReviewRunId) lines.push(`Post-revision review run: ${revision.postRevisionReviewRunId}`);
    if (revision.status === "authorized" || revision.status === "running") lines.push("Revision is not design approval and does not authorize multiple revision rounds.");
  }
  return lines;
}
