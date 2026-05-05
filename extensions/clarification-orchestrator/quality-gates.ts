import type { DesignIssue, RefinerOutput, UserDecision, VerificationResult } from "./types.ts";
import { validateIssueReferences } from "./issues.ts";

export type QualityProblem = { id?: string; message: string; severity: "error" | "warning" };

export function validateReviewerIssueQuality(issues: DesignIssue[]): QualityProblem[] {
  const problems: QualityProblem[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    for (const [field, value] of Object.entries({ title: issue.title, description: issue.description, riskIfIgnored: issue.riskIfIgnored, suggestedChange: issue.suggestedChange })) {
      if (!isActionable(value)) problems.push({ id: issue.id, severity: "error", message: `${field} is empty or non-actionable.` });
    }
    if (!issue.category || !issue.severity || !issue.evidence?.length) problems.push({ id: issue.id, severity: "error", message: "Issue missing category, severity, or evidence." });
    const key = `${issue.title.trim().toLowerCase()}\n${issue.description.trim().toLowerCase()}`;
    if (seen.has(key)) problems.push({ id: issue.id, severity: "warning", message: "Duplicate issue from same reviewer." });
    seen.add(key);
  }
  return problems;
}

export function filterDuplicateReviewerIssues(issues: DesignIssue[]): DesignIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.title.trim().toLowerCase()}\n${issue.description.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function validateTriagerConsistency(issues: DesignIssue[]): QualityProblem[] {
  const problems: QualityProblem[] = [];
  const seenIds = new Set<string>();
  for (const issue of issues) {
    if (seenIds.has(issue.id)) problems.push({ id: issue.id, severity: "error", message: "Duplicate canonical issue id." });
    seenIds.add(issue.id);
    if (issue.severity === "P0" && issue.estimatedCost === "high" && issue.confidence === "low" && issue.recommendation === "must-fix-now") {
      problems.push({ id: issue.id, severity: "warning", message: "High-cost low-confidence P0 requires explicit justification." });
    }
  }
  for (const problem of validateIssueReferences(issues)) problems.push({ id: problem.issueId, severity: "error", message: problem.message });
  return problems;
}

export function validateRefinerQuality(output: RefinerOutput, decisions: UserDecision[]): QualityProblem[] {
  const accepted = decisions.filter((decision) => decision.decision === "accept").map((decision) => decision.issueId);
  const notAccepted = decisions.filter((decision) => decision.decision !== "accept").map((decision) => decision.issueId);
  const changes = new Set(output.changeLog.map((change) => change.issueId));
  const noOps = new Set((output.noOpJustifications ?? []).map((item) => item.issueId));
  const problems: QualityProblem[] = [];
  for (const id of accepted) if (!changes.has(id) && !noOps.has(id)) problems.push({ id, severity: "error", message: "Accepted issue missing from refiner output." });
  for (const id of notAccepted) if (changes.has(id)) problems.push({ id, severity: "error", message: "Rejected/deferred issue appears in refiner change log." });
  return problems;
}

export function validateVerifierQuality(results: VerificationResult[], acceptedIssueIds: string[]): QualityProblem[] {
  const problems: QualityProblem[] = [];
  const seen = new Set(results.map((result) => result.issueId));
  for (const id of acceptedIssueIds) if (!seen.has(id)) problems.push({ id, severity: "error", message: "Accepted issue missing verifier coverage." });
  for (const result of results) {
    if (!acceptedIssueIds.includes(result.issueId)) problems.push({ id: result.issueId, severity: "error", message: "Verifier returned unaccepted issue." });
    if (!isActionable(result.evidence)) problems.push({ id: result.issueId, severity: "error", message: "Verifier evidence is empty or placeholder." });
  }
  return problems;
}

export function assertNoQualityErrors(problems: QualityProblem[]): void {
  const errors = problems.filter((problem) => problem.severity === "error");
  if (errors.length > 0) throw new Error(errors.map((problem) => `${problem.id ?? "unknown"}: ${problem.message}`).join("\n"));
}

function isActionable(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length > 0 && !["todo", "tbd", "n/a", "none", "placeholder", "unknown", "fix it", "bad"].includes(normalized);
}
