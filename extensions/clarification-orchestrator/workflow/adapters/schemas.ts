import type { AgentOutputSchema } from "../../runtime/agent-execution/types.ts";

export type DesignDraftOutput = {
  kind: "design-draft";
  topic: string;
  summary: string;
  designMarkdown: string;
  assumptions: string[];
  nonGoals: string[];
  risks: string[];
  openQuestions: string[];
};

export type PlanDraftOutput = {
  kind: "plan-draft";
  topic: string;
  requirementsMarkdown: string;
  tasksMarkdown: string;
  traceability: Array<{
    requirementId: string;
    designSection?: string;
    taskIds: string[];
  }>;
  assumptions: string[];
  risks: string[];
};

export function createDesignDraftOutputSchema(topic: string): AgentOutputSchema<DesignDraftOutput> {
  return {
    name: "DesignDraftOutput",
    parse: parseJsonObject,
    validate(value) {
      const output = asRecord(value);
      if (output.kind !== "design-draft") throw new Error("Design output kind must be design-draft.");
      if (output.topic !== topic) throw new Error(`Design output topic must be ${topic}.`);
      const draft: DesignDraftOutput = {
        kind: "design-draft",
        topic: asString(output.topic, "topic"),
        summary: asString(output.summary, "summary"),
        designMarkdown: asString(output.designMarkdown, "designMarkdown"),
        assumptions: asStringArray(output.assumptions, "assumptions"),
        nonGoals: asStringArray(output.nonGoals, "nonGoals"),
        risks: asStringArray(output.risks, "risks"),
        openQuestions: asStringArray(output.openQuestions, "openQuestions"),
      };
      validateDesignMarkdown(draft.designMarkdown);
      return draft;
    },
  };
}

export function createPlanDraftOutputSchema(topic: string): AgentOutputSchema<PlanDraftOutput> {
  return {
    name: "PlanDraftOutput",
    parse: parseJsonObject,
    validate(value) {
      const output = asRecord(value);
      if (output.kind !== "plan-draft") throw new Error("Plan output kind must be plan-draft.");
      if (output.topic !== topic) throw new Error(`Plan output topic must be ${topic}.`);
      const draft: PlanDraftOutput = {
        kind: "plan-draft",
        topic: asString(output.topic, "topic"),
        requirementsMarkdown: asString(output.requirementsMarkdown, "requirementsMarkdown"),
        tasksMarkdown: asString(output.tasksMarkdown, "tasksMarkdown"),
        traceability: asTraceability(output.traceability),
        assumptions: asStringArray(output.assumptions, "assumptions"),
        risks: asStringArray(output.risks, "risks"),
      };
      validatePlanMarkdown(draft.requirementsMarkdown, draft.tasksMarkdown);
      return draft;
    },
  };
}

export const designDraftOutputSchema = createDesignDraftOutputSchema;
export const planDraftOutputSchema = createPlanDraftOutputSchema;

const REQUIRED_DESIGN_HEADINGS = [
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

export function validateDesignMarkdown(markdown: string): void {
  if (!markdown.trim()) throw new Error("Design markdown cannot be empty.");
  for (const heading of REQUIRED_DESIGN_HEADINGS) {
    if (!markdown.includes(heading)) throw new Error(`Design markdown missing required heading: ${heading}`);
  }
  rejectPattern(markdown, /^#\s+Requirements Document:/im, "Design markdown must not include generated requirements.md content.");
  rejectPattern(markdown, /^#\s+Implementation Plan:/im, "Design markdown must not include generated tasks.md content.");
  rejectPattern(markdown, /\b(review(ed)?|approval|approved)\s+(complete|completed|passed|granted)\b/i, "Design markdown must not claim review or approval completion.");
}

export function validatePlanMarkdown(requirementsMarkdown: string, tasksMarkdown: string): void {
  if (!requirementsMarkdown.trim()) throw new Error("Requirements markdown cannot be empty.");
  if (!tasksMarkdown.trim()) throw new Error("Tasks markdown cannot be empty.");
  if (!tasksMarkdown.includes("## Tasks")) throw new Error("Tasks markdown must include ## Tasks.");
  if (!/^\s*- \[[ ✅xX]\]\*?\s+\d+(?:\.\d+)?\.?\s+/mu.test(tasksMarkdown)) {
    throw new Error("Tasks markdown must include checkbox task lines.");
  }
  if (/^\s*- \[(?:✅|x|X)\]\*?\s+\d+(?:\.\d+)?\.?\s+/mu.test(tasksMarkdown)) {
    throw new Error("Generated tasks must not be pre-completed.");
  }
  rejectPattern(tasksMarkdown, /execute\s+(?:these\s+)?tasks\s+before\s+plan\s+approval/i, "Plan must not instruct execution before approval.");
  rejectPattern(tasksMarkdown, /modify\s+(?:the\s+)?approved\s+design/i, "Plan must not instruct modification of approved design.");
  rejectPattern(tasksMarkdown, /revise\s+(?:approved\s+)?(?:requirements|design)\s+during\s+execution/i, "Plan must not require revision of approved requirements or design during execution.");
}

function parseJsonObject(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Output must be an object.");
  return value as Record<string, unknown>;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  if (!value.trim()) throw new Error(`${name} cannot be empty.`);
  return value;
}

function asStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`${name} must be an array of strings.`);
  return value;
}

function asTraceability(value: unknown): PlanDraftOutput["traceability"] {
  if (!Array.isArray(value)) throw new Error("traceability must be an array.");
  return value.map((entry, index) => {
    const record = asRecord(entry);
    const requirementId = asString(record.requirementId, `traceability[${index}].requirementId`);
    const taskIds = asStringArray(record.taskIds, `traceability[${index}].taskIds`);
    const designSection = record.designSection === undefined ? undefined : asString(record.designSection, `traceability[${index}].designSection`);
    return { requirementId, ...(designSection ? { designSection } : {}), taskIds };
  });
}

function rejectPattern(value: string, pattern: RegExp, message: string): void {
  if (pattern.test(value)) throw new Error(message);
}
