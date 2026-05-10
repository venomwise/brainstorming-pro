import type { DesignReviewCoverage, DesignReviewCoverageSummary, DesignReviewTriageEngineInput } from "./types.ts";

export function buildDesignReviewCoverageSummary(input: Pick<DesignReviewTriageEngineInput, "coverage">): DesignReviewCoverageSummary {
  if (!input.coverage) {
    return {
      availableReviewers: [],
      selectedReviewers: [],
      unselectedReviewers: [],
      succeededReviewers: [],
      failedReviewers: [],
      pendingRetryReviewers: [],
      status: "unavailable",
      hasIncompleteCoverage: false,
    };
  }
  const coverage = input.coverage;
  const hasIncompleteCoverage = coverage.selectedReviewers.length > 0 && coverage.succeededReviewers.length > 0 && coverage.failedReviewers.length > 0;
  return {
    ...coverage,
    status: hasIncompleteCoverage ? "incomplete" : "complete",
    hasIncompleteCoverage,
  };
}

export function isCompleteCoverage(coverage: DesignReviewCoverageSummary): boolean {
  return coverage.status === "complete" && !coverage.hasIncompleteCoverage;
}
