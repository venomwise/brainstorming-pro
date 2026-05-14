import type { DesignReviewPanelViewModel, FindingClusterViewModel, ReadinessViewModel } from "../review-panel-view-model.ts";

export function renderTriageView(view: DesignReviewPanelViewModel): string[] {
  if (!view.triage) return ["Triage unavailable; renderer did not classify raw findings."];
  return [
    "Triage tiers (runtime supplied):",
    ...renderTier("Must-fix", view.triage.mustFix),
    ...renderTier("Should-fix", view.triage.shouldFix),
    ...renderTier("Notes", view.triage.notes),
  ];
}

export function renderReadinessView(readiness: ReadinessViewModel | undefined): string[] {
  if (!readiness) return ["Readiness unavailable; this is not approval eligibility."];
  const lines = [`Readiness: ${readiness.status}`, "Readiness is not approval."];
  if (readiness.evidence?.length) lines.push(`Evidence: ${readiness.evidence.join(", ")}`);
  if (readiness.ledgerLinks?.length) lines.push(`Readiness links: ${readiness.ledgerLinks.map((link) => link.path ?? link.ref ?? link.label).join(", ")}`);
  return lines;
}

function renderTier(title: string, clusters: FindingClusterViewModel[]): string[] {
  if (!clusters.length) return [`${title}: none`];
  return [`${title}:`, ...clusters.map((cluster) => `  ${cluster.id}: ${cluster.title ? `${cluster.title} — ` : ""}${cluster.description}${sourceText(cluster)}`)];
}

function sourceText(cluster: FindingClusterViewModel): string {
  const parts = [cluster.sourceReviewerIds?.length ? `reviewers ${cluster.sourceReviewerIds.join(",")}` : undefined, cluster.sourceFindingIds?.length ? `findings ${cluster.sourceFindingIds.join(",")}` : undefined, cluster.affectedSections?.length ? `sections ${cluster.affectedSections.join(",")}` : undefined].filter(Boolean);
  return parts.length ? ` (${parts.join("; ")})` : "";
}
