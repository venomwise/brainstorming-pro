import type { DesignIssue, Evidence } from "./types.ts";

export type IssueValidationProblem = {
  issueId?: string;
  message: string;
};

export function assignStableIssueIds(issues: DesignIssue[], round: number): DesignIssue[] {
  return issues.map((issue, index) => ({
    ...issue,
    id: issue.id && issue.id.startsWith(`BP-R${round}-I`) ? issue.id : `BP-R${round}-I${String(index + 1).padStart(3, "0")}`,
    sourceIssueIds: preserveSourceIssueIds(issue),
  }));
}

export function preserveSourceIssueIds(issue: DesignIssue): string[] {
  const ids = new Set<string>();
  if (issue.id) ids.add(issue.id);
  for (const sourceId of issue.sourceIssueIds ?? []) ids.add(sourceId);
  return Array.from(ids);
}

export function canonicalizeIssues(issues: DesignIssue[], round: number): DesignIssue[] {
  const seen = new Set<string>();
  const canonical: DesignIssue[] = [];

  for (const issue of assignStableIssueIds(issues, round)) {
    const key = `${issue.title.trim().toLowerCase()}\n${issue.description.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    canonical.push(issue);
  }

  return canonical;
}

export function validateIssueReferences(issues: DesignIssue[]): IssueValidationProblem[] {
  const ids = new Set(issues.map((issue) => issue.id));
  const problems: IssueValidationProblem[] = [];

  for (const issue of issues) {
    for (const dep of issue.dependsOn ?? []) {
      if (!ids.has(dep)) problems.push({ issueId: issue.id, message: `dependsOn references missing issue ${dep}` });
    }
    for (const conflict of issue.conflictsWith ?? []) {
      if (!ids.has(conflict)) problems.push({ issueId: issue.id, message: `conflictsWith references missing issue ${conflict}` });
    }
    if (issue.duplicateOf && !ids.has(issue.duplicateOf)) {
      problems.push({ issueId: issue.id, message: `duplicateOf references missing issue ${issue.duplicateOf}` });
    }
    if (issue.severity === "P0" && issue.recommendation !== "must-fix-now") {
      problems.push({ issueId: issue.id, message: "P0 issues must use must-fix-now recommendation unless explicitly downgraded before canonicalization" });
    }
    for (const evidence of issue.evidence) {
      if (!isConcreteEvidence(evidence)) {
        problems.push({ issueId: issue.id, message: "Evidence must be concrete and non-placeholder" });
      }
    }
  }

  return problems;
}

export function assertIssueReferencesValid(issues: DesignIssue[]): void {
  const problems = validateIssueReferences(issues);
  if (problems.length > 0) {
    throw new Error(problems.map((problem) => `${problem.issueId ?? "unknown"}: ${problem.message}`).join("\n"));
  }
}

export function isConcreteEvidence(evidence: Evidence): boolean {
  if (evidence.type === "design-section") {
    return isConcrete(evidence.section) && isConcrete(evidence.quote);
  }
  if (evidence.type === "artifact") {
    return isConcrete(evidence.path) && (evidence.quote === undefined || isConcrete(evidence.quote));
  }
  return isConcrete(evidence.path) && (evidence.quote === undefined || isConcrete(evidence.quote));
}

function isConcrete(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && !["todo", "tbd", "n/a", "none", "placeholder", "unknown"].includes(normalized);
}
