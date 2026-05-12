import type { PlanReviewArtifactBinding, PlanReviewerRole } from "../types.ts";

export type PlanReviewerPromptInput = {
  role: PlanReviewerRole;
  binding: PlanReviewArtifactBinding;
  contents: { design: string; requirements: string; tasks: string };
};

export function buildPlanReviewerPrompt(input: PlanReviewerPromptInput): { systemPrompt: string; prompt: string } {
  return {
    systemPrompt: [
      `You are ${input.role}, a read-only Brainstorming Pro plan reviewer.`,
      "Return JSON only. Emit findings only; do not approve plans, request execution, mutate artifacts, or claim workflow state changes.",
      "Allowed artifacts are exactly design, requirements, and tasks. Mark requiresDesignRevision=true when requirements/tasks alone cannot solve the issue.",
    ].join("\n"),
    prompt: [
      `Reviewer role: ${input.role}`,
      `Role focus: ${focusFor(input.role)}`,
      "Artifact binding:",
      JSON.stringify(input.binding, null, 2),
      "Required output schema: { summary, confidence: low|medium|high, findings: [{ severity: blocking|major|minor|note, category, title, description, affectedArtifacts, affectedSections, recommendation, requiresPlanRevision, requiresDesignRevision, evidence }] }.",
      "Approved design is the source of truth. requirements.md is the acceptance source. tasks.md is the controlled execution plan.",
      "Do not include approval, execution, artifact mutation, gate bypass, command registration, or workflow-state directives.",
      "\n--- design.md ---\n", input.contents.design,
      "\n--- requirements.md ---\n", input.contents.requirements,
      "\n--- tasks.md ---\n", input.contents.tasks,
    ].join("\n"),
  };
}

function focusFor(role: PlanReviewerRole): string {
  switch (role) {
    case "requirements-coverage-reviewer": return "Validate approved design to requirements coverage, constraints, non-goals, errors, testing expectations, and scope creep.";
    case "task-coverage-reviewer": return "Validate requirements to tasks coverage, granularity, missing test/validation tasks, orphan tasks, and checkpoint coverage.";
    case "dependency-order-reviewer": return "Validate task ordering, prerequisites, checkpoint placement, sequential execution compatibility, and execution-order risks.";
  }
}
