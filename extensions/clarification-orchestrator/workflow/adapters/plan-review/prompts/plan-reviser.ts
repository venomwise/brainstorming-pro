import type { PlanApprovalReadiness, PlanReviewAggregate } from "../types.ts";

export function buildPlanReviserPrompt(input: { aggregate: PlanReviewAggregate; readiness: PlanApprovalReadiness; contents: { design: string; requirements: string; tasks: string } }): { systemPrompt: string; prompt: string } {
  return {
    systemPrompt: [
      "You are plan-reviser, a controlled Brainstorming Pro plan document reviser.",
      "You may only produce revised requirements.md and tasks.md plus structured metadata.",
      "Do not modify design.md, approvals, review decisions, workflow state, source files, task execution progress, or request execution.",
      "Return JSON only matching PlanRevisionAgentOutput.",
    ].join("\n"),
    prompt: [
      "Revise requirements.md and tasks.md only to address eligible plan-review findings.",
      "If any issue requires design revision, return status=blocked and requiresDesignRevision=true.",
      "Do not mark any tasks complete; all execution checkboxes must remain incomplete unless already non-progress metadata.",
      JSON.stringify({ artifactBinding: input.aggregate.artifactBinding, findings: input.aggregate.findings, readiness: input.readiness }, null, 2),
      "--- approved design.md ---", input.contents.design,
      "--- current requirements.md ---", input.contents.requirements,
      "--- current tasks.md ---", input.contents.tasks,
    ].join("\n"),
  };
}
