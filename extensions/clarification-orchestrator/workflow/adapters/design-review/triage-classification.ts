import type { DesignReviewFindingCluster, DesignReviewTriageLevel } from "./types.ts";
import type { DesignReviewConflict } from "./types.ts";

export function classifyDesignReviewClusters(clusters: readonly DesignReviewFindingCluster[], conflicts: readonly DesignReviewConflict[] = []): DesignReviewFindingCluster[] {
  const conflictClusterIds = new Set(conflicts.filter((conflict) => conflict.impact !== "informational").flatMap((conflict) => conflict.clusterIds));
  return clusters.map((cluster) => {
    const mustFix = cluster.severity === "blocking" || cluster.requiresRevision || conflictClusterIds.has(cluster.clusterId) || cluster.userQuestions.length > 0;
    const shouldFix = !mustFix && (cluster.severity === "non-blocking" || cluster.recommendations.length > 0 || cluster.affectedSections.length > 0);
    const triageLevel: DesignReviewTriageLevel = mustFix ? "must-fix" : shouldFix ? "should-fix" : "note";
    return { ...cluster, triageLevel };
  }).sort((left, right) => left.clusterId.localeCompare(right.clusterId));
}
