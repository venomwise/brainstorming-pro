import type { VersionedArtifactRef } from "../../types.ts";
import { evaluateDesignApprovalReadiness } from "./readiness.ts";
import { assertCoverageConsistent } from "./review-coverage.ts";
import type { DesignReviewAggregateResult, DesignReviewCounts, DesignReviewCoverage, DesignReviewerResult } from "./types.ts";

export function aggregatePartialDesignReviewFindings(input: {
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  successfulResults: readonly DesignReviewerResult[];
  failedResults: readonly DesignReviewerResult[];
  coverage: DesignReviewCoverage;
}): DesignReviewAggregateResult {
  assertCoverageConsistent(input.coverage);
  if (input.successfulResults.some((result) => result.status !== "succeeded")) throw new Error("Partial aggregation successfulResults must all be succeeded.");
  if (input.failedResults.some((result) => result.status !== "failed")) throw new Error("Partial aggregation failedResults must all be failed.");
  const findings = input.successfulResults.flatMap((result) => result.findings);
  const blocking = findings.filter((finding) => finding.severity === "blocking").length;
  const status = blocking > 0 ? "blocked" : "partial";
  const counts: DesignReviewCounts = {
    blocking,
    nonBlocking: findings.filter((finding) => finding.severity === "non-blocking").length,
    notes: findings.filter((finding) => finding.severity === "note").length,
    byCategory: countBy(findings, (finding) => finding.category),
    byReviewer: countBy(findings, (finding) => finding.reviewerRole),
  };
  const readiness = evaluateDesignApprovalReadiness({ status, findings, coverage: input.coverage });
  return {
    reviewRunId: input.reviewRunId,
    designRef: input.designRef,
    status,
    summary: status === "blocked"
      ? `Partial design review found ${blocking} blocking finding(s); failed reviewer diagnostics remain separate.`
      : `Partial design review preserved ${findings.length} finding(s) from successful reviewers; failed reviewer diagnostics remain separate.`,
    counts,
    findings,
    readiness,
    coverage: input.coverage,
  };
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}
