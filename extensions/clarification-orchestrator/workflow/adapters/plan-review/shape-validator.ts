import { parseTaskPlan } from "../spec-exec/task-plan-parser.ts";
import type { PlanReviewArtifactBinding, PlanReviewFindingDraft } from "./types.ts";

export type PlanShapeValidationResult =
  | { ok: true; findings: PlanReviewFindingDraft[] }
  | { ok: false; diagnostics: string[]; findings: PlanReviewFindingDraft[] };

export function validatePlanShape(input: { requirementsContent: string; tasksContent: string; binding: PlanReviewArtifactBinding }): PlanShapeValidationResult {
  const findings: PlanReviewFindingDraft[] = [];
  const diagnostics: string[] = [];

  if (!hasRequirementsStructure(input.requirementsContent)) {
    findings.push(formatFinding("requirements.md is missing the required requirements structure.", "Add a Requirements section with numbered requirements and acceptance criteria.", ["requirements"]));
  }

  const parsed = parseTaskPlan(input.tasksContent);
  if (parsed.tasksSectionStartLine === 0) {
    diagnostics.push("tasks.md is missing a parseable ## Tasks section.");
    return { ok: false, diagnostics, findings };
  }
  if (parsed.tasks.length === 0) {
    diagnostics.push("tasks.md ## Tasks section contains no parseable task entries.");
    return { ok: false, diagnostics, findings };
  }

  const severeReasons = new Set(["duplicate-task-id", "missing-parent-task", "unsupported-task-numbering-depth"]);
  for (const malformed of parsed.malformed) {
    const title = `Malformed task plan entry: ${malformed.reason}`;
    const recommendation = recommendationFor(malformed.reason);
    if (severeReasons.has(malformed.reason)) diagnostics.push(`${title} at line ${malformed.lineNumber}.`);
    else findings.push(formatFinding(title, recommendation, ["tasks"], [`line ${malformed.lineNumber}`]));
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics, findings };
  return { ok: true, findings };
}

function hasRequirementsStructure(markdown: string): boolean {
  return /^##\s+Requirements\s*$/imu.test(markdown)
    && /^###\s+Requirement\s+\d+\s*:/imu.test(markdown)
    && /^####\s+Acceptance Criteria\s*$/imu.test(markdown)
    && /^\s*\d+\.\s+(?:WHEN|IF)\b.+\bTHEN\b/imu.test(markdown);
}

function formatFinding(title: string, recommendation: string, affectedArtifacts: Array<"requirements" | "tasks">, affectedSections: string[] = []): PlanReviewFindingDraft {
  return {
    severity: "blocking",
    category: affectedArtifacts.includes("tasks") ? "artifact-format" : "requirements-coverage",
    title,
    description: title,
    affectedArtifacts,
    affectedSections,
    recommendation,
    requiresPlanRevision: true,
    requiresDesignRevision: false,
  };
}

function recommendationFor(reason: string): string {
  switch (reason) {
    case "missing-executable-requirements": return "Add _Requirements: ..._ metadata to every executable task or checkpoint.";
    case "invalid-checkbox-marker-or-task-line": return "Use supported task checkbox markers: [ ], [✅], optionally followed by * for optional tasks.";
    case "ambiguous-nesting":
    case "ambiguous-parent-child-indentation": return "Use two-space indentation with root phases and indented sub-tasks.";
    default: return "Repair tasks.md to match the controlled spec-exec task plan format.";
  }
}
