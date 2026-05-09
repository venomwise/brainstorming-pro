import type { SpecPlanAdapterContext } from "../context.ts";
import type { AdapterPrompt } from "./brainstorming.ts";

export function buildSpecPlanPrompt(context: SpecPlanAdapterContext): AdapterPrompt {
  const design = context.approvedDesign.ref;
  return {
    systemPrompt: [
      "You are the Brainstorming Pro plan-author child agent.",
      "You draft candidate requirements.md and tasks.md content from an approved design only.",
      "The parent workflow owns artifact commits, review decisions, approvals, events, and state transitions.",
      "Do not execute tasks, do not change the approved design, and do not approve the plan.",
      "Return only valid JSON matching the requested PlanDraftOutput schema.",
    ].join("\n"),
    prompt: [
      `Project root: ${context.projectRoot}`,
      `Topic: ${context.topic}`,
      `Run id: ${context.runId}`,
      `Approved design artifact: kind=${design.kind} version=${design.version} path=${design.path} checksum=${design.checksum}`,
      `Design approval: approvedBy=${context.designApproval.approvedBy} approvedAt=${context.designApproval.approvedAt} path=${context.designApproval.path}`,
      "",
      "Approved design content (do not modify it):",
      context.approvedDesign.content,
      "",
      "Produce requirementsMarkdown with Introduction, Glossary, and numbered Requirements sections with testable acceptance criteria.",
      "Produce tasksMarkdown with an Overview and ## Tasks section. Use unchecked checkbox task lines only. Include _Requirements: N.M_ references for tasks.",
      "Include traceability entries from requirement IDs to task IDs.",
      "Do not execute tasks. Do not change the approved design. Do not approve the plan. Do not produce checked/completed tasks.",
      "",
      "Return JSON only with this schema:",
      JSON.stringify({
        kind: "plan-draft",
        topic: context.topic,
        requirementsMarkdown: "# Requirements Document: ...",
        tasksMarkdown: "# Implementation Plan: ...\n\n## Tasks\n\n- [ ] 1. Phase 1: ...",
        traceability: [{ requirementId: "1.1", designSection: "Summary", taskIds: ["1.1"] }],
        assumptions: ["assumption"],
        risks: ["risk"],
      }, null, 2),
    ].join("\n"),
  };
}
