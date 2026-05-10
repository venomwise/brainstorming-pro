import { createHash } from "node:crypto";
import type { DesignReviewFinding, DesignReviewFindingCluster, DesignReviewTriageLevel } from "./types.ts";

export function clusterDesignReviewFindings(findings: readonly DesignReviewFinding[]): DesignReviewFindingCluster[] {
  const groups = new Map<string, DesignReviewFinding[]>();
  for (const finding of findings) {
    const key = clusterKey(finding);
    const bucket = groups.get(key);
    if (bucket) bucket.push(finding);
    else groups.set(key, [finding]);
  }
  return [...groups.entries()].map(([key, bucket]) => buildCluster(key, bucket)).sort((left, right) => left.clusterId.localeCompare(right.clusterId));
}

function buildCluster(key: string, findings: readonly DesignReviewFinding[]): DesignReviewFindingCluster {
  const sourceFindingIds = findings.map((finding) => finding.id).sort();
  const reviewerRoles = [...new Set(findings.map((finding) => finding.reviewerRole))].sort();
  const severity = highestSeverity(findings.map((finding) => finding.severity));
  const triageLevel: DesignReviewTriageLevel = severity === "blocking" ? "must-fix" : severity === "non-blocking" ? "should-fix" : "note";
  return {
    clusterId: `cluster-${checksum(`${key}:${sourceFindingIds.join("|")}`).slice(0, 12)}`,
    triageLevel,
    sourceFindingIds,
    reviewerRoles,
    category: chooseCategory(findings),
    severity,
    requiresRevision: findings.some((finding) => finding.requiresRevision),
    title: findings[0].title,
    description: findings[0].description,
    evidence: compactUnique(findings.flatMap((finding) => finding.evidence ? [finding.evidence] : [])),
    affectedSections: compactUnique(findings.flatMap((finding) => finding.affectedSections ?? [])),
    recommendations: compactUnique(findings.flatMap((finding) => finding.recommendation ? [finding.recommendation] : [])),
    userQuestions: compactUnique(findings.flatMap((finding) => finding.userQuestion ? [finding.userQuestion] : [])),
  };
}

function clusterKey(finding: DesignReviewFinding): string {
  return [finding.category, finding.severity, normalize(finding.title), normalize(finding.description), normalize(finding.recommendation ?? ""), normalize((finding.affectedSections ?? []).join("|")), finding.requiresRevision ? "1" : "0", normalize(finding.userQuestion ?? "")].join("::");
}

function chooseCategory(findings: readonly DesignReviewFinding[]): DesignReviewFinding["category"] {
  return findings.reduce((winner, finding) => categoryWeight(finding.category) > categoryWeight(winner) ? finding.category : winner, findings[0].category);
}

function highestSeverity(severities: readonly DesignReviewFinding["severity"][]): DesignReviewFinding["severity"] {
  if (severities.includes("blocking")) return "blocking";
  if (severities.includes("non-blocking")) return "non-blocking";
  return "note";
}

function categoryWeight(category: DesignReviewFinding["category"]): number {
  return { "risk-security": 5, architecture: 4, product: 3, testing: 2, "scope-simplicity": 1, consistency: 0, "missing-context": 0 }[category];
}

function compactUnique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function checksum(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
