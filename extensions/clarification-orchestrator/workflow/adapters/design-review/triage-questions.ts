import type { DesignReviewFinding, DesignReviewUnresolvedQuestion } from "./types.ts";

export function extractDesignReviewUnresolvedQuestions(findings: readonly DesignReviewFinding[]): DesignReviewUnresolvedQuestion[] {
  const grouped = new Map<string, DesignReviewFinding[]>();
  for (const finding of findings) {
    if (!finding.userQuestion) continue;
    const key = normalize(finding.userQuestion);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(finding);
    else grouped.set(key, [finding]);
  }
  return [...grouped.entries()].map(([key, bucket]) => ({
    questionId: `question-${checksum(key).slice(0, 12)}`,
    question: bucket[0].userQuestion ?? "",
    blocking: bucket.some((finding) => isBlockingQuestion(finding)),
    sourceFindingIds: bucket.map((finding) => finding.id).sort(),
    clusterIds: [],
    reviewerRoles: [...new Set(bucket.map((finding) => finding.reviewerRole))].sort(),
    relatedSections: [...new Set(bucket.flatMap((finding) => finding.affectedSections ?? []))].sort(),
  })).sort((left, right) => left.questionId.localeCompare(right.questionId));
}

function isBlockingQuestion(finding: DesignReviewFinding): boolean {
  if (finding.severity === "blocking" || finding.requiresRevision) return true;
  return /scope|architecture|requirements|data model|security|gate|approval/u.test(finding.userQuestion ?? "");
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function checksum(value: string): string {
  let hash = 0;
  for (const char of value) hash = Math.imul(31, hash) + char.charCodeAt(0) | 0;
  return Math.abs(hash).toString(16);
}
