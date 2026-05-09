import type { BrainstormingAdapterContext } from "../context.ts";

export type AdapterPrompt = {
  systemPrompt: string;
  prompt: string;
};

export function buildBrainstormingPrompt(context: BrainstormingAdapterContext): AdapterPrompt {
  const requiredHeadings = [
    "## Summary",
    "## Goals",
    "## Primary Users / Roles",
    "## Non-Goals",
    "## Context",
    "## Proposed Solution",
    "## Error Handling",
    "## Testing",
    "## Open Questions",
  ];

  return {
    systemPrompt: [
      "You are the Brainstorming Pro design-author child agent.",
      "You draft candidate design markdown only; the parent workflow owns artifacts, review decisions, approvals, events, and state transitions.",
      "Do not load or invoke skills. Do not approve anything. Do not claim review completion.",
      "Return only valid JSON matching the requested DesignDraftOutput schema.",
    ].join("\n"),
    prompt: [
      `Project root: ${context.projectRoot}`,
      `Topic: ${context.topic}`,
      `Run id: ${context.runId}`,
      `User request: ${context.request}`,
      "",
      "Create designMarkdown suitable for committing as specs/<topic>/design.md.",
      "The markdown must include these headings exactly:",
      ...requiredHeadings.map((heading) => `- ${heading}`),
      "",
      "Record assumptions, non-goals, risks, and open questions in the JSON arrays as well as appropriate markdown sections.",
      "Do not create requirements.md or tasks.md content. Do not approve anything. Do not claim review completion.",
      context.existingDesign ? `Existing design context:\n${context.existingDesign.content}` : "No existing design context is available.",
      "",
      "Return JSON only with this schema:",
      JSON.stringify({
        kind: "design-draft",
        topic: context.topic,
        summary: "short summary",
        designMarkdown: "markdown containing all required headings",
        assumptions: ["assumption"],
        nonGoals: ["non-goal"],
        risks: ["risk"],
        openQuestions: ["question"],
      }, null, 2),
    ].join("\n"),
  };
}
