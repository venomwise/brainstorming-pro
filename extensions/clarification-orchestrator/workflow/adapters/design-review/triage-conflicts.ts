import type { DesignReviewConflict, DesignReviewFinding, DesignReviewFindingCluster } from "./types.ts";

export function detectDesignReviewConflicts(clusters: readonly DesignReviewFindingCluster[], findings: readonly DesignReviewFinding[]): DesignReviewConflict[] {
  const conflicts: DesignReviewConflict[] = [];
  const clusterByFindingId = new Map(findings.map((finding) => [finding.id, clusters.find((cluster) => cluster.sourceFindingIds.includes(finding.id))?.clusterId ?? finding.id]));
  const recommendationPairs = pairwiseConflicts(findings, (left, right) => normalize(left.recommendation ?? "") !== normalize(right.recommendation ?? ""));
  if (recommendationPairs.length > 0) conflicts.push(buildConflict("recommendation-conflict", clusters, recommendationPairs, "Findings offer incompatible recommendations.", "Reviewers recommend different next steps."));
  const severityPairs = pairwiseConflicts(findings, (left, right) => left.severity !== right.severity);
  if (severityPairs.length > 0) conflicts.push(buildConflict("severity-disagreement", clusters, severityPairs, "Findings disagree on severity.", "Reviewers disagree on whether the issue blocks revision."));
  if (hasScopeConflict(findings)) conflicts.push(buildConflict("scope-disagreement", clusters, pairwiseConflicts(findings, () => true), "Findings disagree on scope direction.", "Some findings push scope expansion while others push trimming."));
  const readinessPairs = pairwiseConflicts(findings, (left, right) => hasReadinessConflict(left, right));
  if (readinessPairs.length > 0) conflicts.push(buildConflict("readiness-disagreement", clusters, readinessPairs, "Findings disagree on readiness.", "One finding suggests readiness while another identifies a blocker."));
  return conflicts.map((conflict) => ({ ...conflict, clusterIds: conflict.sourceFindingIds.map((id) => clusterByFindingId.get(id) ?? id).filter((id, index, array) => array.indexOf(id) === index).sort() })).sort((left, right) => left.conflictId.localeCompare(right.conflictId));
}

function buildConflict(type: DesignReviewConflict["type"], clusters: readonly DesignReviewFindingCluster[], pairs: Array<[DesignReviewFinding, DesignReviewFinding]>, summary: string, details: string): DesignReviewConflict {
  const sourceFindings = pairs.flat();
  const clusterIds = [...new Set(sourceFindings.map((finding) => clusters.find((cluster) => cluster.sourceFindingIds.includes(finding.id))?.clusterId ?? finding.id))].sort();
  return {
    conflictId: `${type}-${checksum(sourceFindings.map((finding) => finding.id).sort().join("|"))}`,
    type,
    impact: sourceFindings.some((finding) => finding.category === "risk-security" || finding.severity === "blocking") ? "blocking-approval-readiness" : "requires-resolution-before-revision",
    sourceFindingIds: [...new Set(sourceFindings.map((finding) => finding.id))].sort(),
    clusterIds,
    reviewerRoles: [...new Set(sourceFindings.map((finding) => finding.reviewerRole))].sort(),
    summary,
    details,
  };
}

function pairwiseConflicts(findings: readonly DesignReviewFinding[], predicate: (left: DesignReviewFinding, right: DesignReviewFinding) => boolean): Array<[DesignReviewFinding, DesignReviewFinding]> {
  const pairs: Array<[DesignReviewFinding, DesignReviewFinding]> = [];
  for (let leftIndex = 0; leftIndex < findings.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < findings.length; rightIndex += 1) {
      if (predicate(findings[leftIndex], findings[rightIndex])) pairs.push([findings[leftIndex], findings[rightIndex]]);
    }
  }
  return pairs;
}

function hasScopeConflict(findings: readonly DesignReviewFinding[]): boolean {
  const recommendations = findings.map((finding) => finding.recommendation ?? "");
  return recommendations.some((text) => /expand|broaden|increase/iu.test(text)) && recommendations.some((text) => /trim|reduce|narrow|shrink/iu.test(text));
}

function hasReadinessConflict(left: DesignReviewFinding, right: DesignReviewFinding): boolean {
  return (left.severity === "blocking" || left.requiresRevision) !== (right.severity === "blocking" || right.requiresRevision);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function checksum(value: string): string {
  let hash = 0;
  for (const char of value) hash = Math.imul(31, hash) + char.charCodeAt(0) | 0;
  return Math.abs(hash).toString(16);
}
