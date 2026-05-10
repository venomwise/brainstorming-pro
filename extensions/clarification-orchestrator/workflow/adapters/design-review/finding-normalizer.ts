import path from "node:path";
import { validateDesignReviewFindingDraft } from "./schemas.ts";
import type { DesignReviewFinding, DesignReviewFindingDraft, DesignReviewerRole } from "./types.ts";
import type { VersionedArtifactRef } from "../../types.ts";

export function normalizeDesignReviewFindings(input: {
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  reviewerRole: DesignReviewerRole;
  findings: DesignReviewFindingDraft[];
  topicDir?: string;
}): DesignReviewFinding[] {
  return input.findings.map((finding, index) => {
    const draft = validateDesignReviewFindingDraft(finding, `findings[${index}]`);
    assertSafeFindingPaths(draft, input.topicDir);
    return {
      id: `${input.reviewerRole}-${String(index + 1).padStart(3, "0")}`,
      reviewRunId: input.reviewRunId,
      designRef: input.designRef,
      reviewerRole: input.reviewerRole,
      ...draft,
    };
  });
}

function assertSafeFindingPaths(finding: DesignReviewFindingDraft, topicDir?: string): void {
  const values = [...(finding.affectedSections ?? []), finding.evidence ?? "", finding.description, finding.recommendation ?? ""];
  for (const value of values) {
    if (/\.\.[/\\]/u.test(value)) throw new Error("Reviewer finding references a parent-directory path.");
    const absolutePathMatches = value.matchAll(/(?:^|\s)(\/[^\s`'"]+)/gu);
    for (const match of absolutePathMatches) {
      if (!topicDir) throw new Error("Reviewer finding references an absolute path.");
      const target = path.resolve(match[1]);
      const relative = path.relative(path.resolve(topicDir), target);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Reviewer finding references a path outside the topic directory.");
    }
  }
}
