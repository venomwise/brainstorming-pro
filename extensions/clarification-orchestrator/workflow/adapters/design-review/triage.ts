import type { DesignReviewTriageEngineInput, DesignReviewTriageReport } from "./types.ts";
import { classifyDesignReviewClusters } from "./triage-classification.ts";
import { detectDesignReviewConflicts } from "./triage-conflicts.ts";
import { buildDesignReviewCoverageSummary } from "./triage-coverage.ts";
import { clusterDesignReviewFindings } from "./triage-deduplication.ts";
import { extractDesignReviewUnresolvedQuestions } from "./triage-questions.ts";
import { buildDesignReviewReadinessReport } from "./triage-readiness.ts";
import { validateDesignReviewTriageReport } from "./triage-schemas.ts";
import { buildDesignReviewUserFacingSummary } from "./triage-summary.ts";

export function buildDesignReviewTriageReport(input: DesignReviewTriageEngineInput): DesignReviewTriageReport {
  const initialClusters = clusterDesignReviewFindings(input.findings);
  const conflicts = detectDesignReviewConflicts(initialClusters, input.findings);
  const clusters = classifyDesignReviewClusters(initialClusters, conflicts);
  const unresolvedQuestions = extractDesignReviewUnresolvedQuestions(input.findings);
  const coverage = buildDesignReviewCoverageSummary({ coverage: input.coverage });
  const readiness = buildDesignReviewReadinessReport({ sourceReadiness: input.currentReadiness ?? input.aggregate.readiness, clusters, conflicts, unresolvedQuestions });
  const partialReport = {
    reviewRunId: input.reviewRun.reviewRunId,
    designRef: input.reviewRun.designRef,
    status: "fresh" as const,
    generatedAt: new Date().toISOString(),
    sources: input.sources,
    findings: [...input.findings],
    clusters,
    conflicts,
    unresolvedQuestions,
    coverage,
    readiness,
    summary: "pending",
  };
  const report = { ...partialReport, summary: buildDesignReviewUserFacingSummary(partialReport) };
  return validateDesignReviewTriageReport(report);
}
