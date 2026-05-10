import type { DesignReviewAggregateResult, DesignReviewCoverage, DesignReviewFinding, DesignReviewPanelStatus } from "./types.ts";
import type { VersionedArtifactRef } from "../../types.ts";
import { evaluateDesignApprovalReadiness } from "./readiness.ts";

export function aggregateDesignReviewFindings(input: {
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  findings: DesignReviewFinding[];
  forcedStatus?: DesignReviewPanelStatus;
  coverage?: DesignReviewCoverage;
}): DesignReviewAggregateResult {
  const blocking = input.findings.filter((finding) => finding.severity === "blocking").length;
  const nonBlocking = input.findings.filter((finding) => finding.severity === "non-blocking").length;
  const notes = input.findings.filter((finding) => finding.severity === "note").length;
  const status = input.forcedStatus ?? (blocking > 0 ? "blocked" : "passed");
  const counts = {
    blocking,
    nonBlocking,
    notes,
    byCategory: countBy(input.findings, (finding) => finding.category),
    byReviewer: countBy(input.findings, (finding) => finding.reviewerRole),
  };
  const readiness = evaluateDesignApprovalReadiness({ status, findings: input.findings, coverage: input.coverage });
  return {
    reviewRunId: input.reviewRunId,
    designRef: input.designRef,
    status,
    summary: summary(status, counts.blocking, input.findings.length),
    counts,
    findings: input.findings,
    readiness,
    coverage: input.coverage,
  };
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function summary(status: DesignReviewPanelStatus, blocking: number, total: number): string {
  if (status === "passed") return `Design review passed with ${total} finding(s) and no blocking finding(s).`;
  if (status === "blocked") return `Design review blocked by ${blocking} blocking finding(s).`;
  if (status === "skipped") return "Design review skipped by user.";
  if (status === "unavailable") return "Design review unavailable.";
  if (status === "partial") return `Design review incomplete with ${total} finding(s) from successful reviewer(s).`;
  return "Design review failed.";
}
