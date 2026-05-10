import type { AgentOutputSchema } from "../../../runtime/agent-execution/types.ts";
import type { DesignReviewerOutput, DesignReviewFindingCategory, DesignReviewFindingDraft, DesignReviewFindingSeverity, MinimalDesignReviewOutput } from "./types.ts";

const categories = new Set<DesignReviewFindingCategory>(["product", "architecture", "risk-security", "testing", "scope-simplicity", "consistency", "missing-context"]);
const severities = new Set<DesignReviewFindingSeverity>(["blocking", "non-blocking", "note"]);
const forbiddenKeys = new Set([
  "approved",
  "approval",
  "approve",
  "approveDesign",
  "statePatch",
  "workflowState",
  "workflowStatePatch",
  "phase",
  "phaseTransition",
  "nextPhase",
  "artifacts",
  "artifactCommit",
  "commitArtifacts",
  "gateDecision",
  "skipGate",
  "skipGates",
  "mutations",
]);

export const designReviewerOutputSchema: AgentOutputSchema<DesignReviewerOutput> = {
  name: "DesignReviewerOutput",
  parse(raw) {
    return JSON.parse(raw) as unknown;
  },
  validate(value) {
    const record = asRecord(value, "output");
    rejectUnauthorizedDirectives(record);
    const output: DesignReviewerOutput = {
      summary: asNonEmptyString(record.summary, "summary"),
      confidence: asConfidence(record.confidence),
      findings: asFindings(record.findings),
    };
    return output;
  },
};

export const minimalDesignReviewOutputSchema: AgentOutputSchema<MinimalDesignReviewOutput> = {
  ...designReviewerOutputSchema,
  name: "MinimalDesignReviewOutput",
};

export function validateDesignReviewFindingDraft(value: unknown, name = "finding"): DesignReviewFindingDraft {
  const record = asRecord(value, name);
  rejectUnauthorizedDirectives(record);
  const category = asEnum(record.category, categories, `${name}.category`);
  const severity = asEnum(record.severity, severities, `${name}.severity`);
  const title = asNonEmptyString(record.title, `${name}.title`);
  const description = asNonEmptyString(record.description, `${name}.description`);
  const requiresRevision = asBoolean(record.requiresRevision, `${name}.requiresRevision`);
  const userQuestion = optionalString(record.userQuestion, `${name}.userQuestion`);
  if (severity === "blocking" && !requiresRevision && !userQuestion) throw new Error(`${name}: blocking findings must require revision or include a user question.`);
  return {
    category,
    severity,
    title,
    description,
    ...(optionalString(record.evidence, `${name}.evidence`) ? { evidence: optionalString(record.evidence, `${name}.evidence`) } : {}),
    ...(optionalStringArray(record.affectedSections, `${name}.affectedSections`) ? { affectedSections: optionalStringArray(record.affectedSections, `${name}.affectedSections`) } : {}),
    ...(optionalString(record.recommendation, `${name}.recommendation`) ? { recommendation: optionalString(record.recommendation, `${name}.recommendation`) } : {}),
    requiresRevision,
    ...(userQuestion ? { userQuestion } : {}),
  };
}

export function rejectUnauthorizedDirectives(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (forbiddenKeys.has(key)) throw new Error(`Reviewer output contains unauthorized directive: ${key}`);
  }
}

function asFindings(value: unknown): DesignReviewFindingDraft[] {
  if (!Array.isArray(value)) throw new Error("findings must be an array.");
  return value.map((item, index) => validateDesignReviewFindingDraft(item, `findings[${index}]`));
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return asNonEmptyString(value, name);
}

function optionalStringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.trim())) throw new Error(`${name} must be an array of non-empty strings.`);
  return value;
}

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean.`);
  return value;
}

function asEnum<T extends string>(value: unknown, values: Set<T>, name: string): T {
  if (typeof value !== "string" || !values.has(value as T)) throw new Error(`${name} must be one of: ${[...values].join(", ")}.`);
  return value as T;
}

function asConfidence(value: unknown): DesignReviewerOutput["confidence"] {
  return asEnum(value, new Set(["low", "medium", "high"]), "confidence");
}
