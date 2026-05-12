import type { AgentOutputSchema } from "../../../runtime/agent-execution/types.ts";
import type { PlanApprovalReadiness, PlanReviewAggregate, PlanReviewArtifactName, PlanReviewFindingCategory, PlanReviewFindingDraft, PlanReviewFindingSeverity, PlanRevisionAgentOutput, PlanReviewerOutput } from "./types.ts";

const artifacts = new Set<PlanReviewArtifactName>(["design", "requirements", "tasks"]);
const severities = new Set<PlanReviewFindingSeverity>(["blocking", "major", "minor", "note"]);
const categories = new Set<PlanReviewFindingCategory>(["requirements-coverage", "task-coverage", "dependency-order", "artifact-format", "missing-validation", "scope-creep", "consistency", "trust-boundary"]);
const readinessStatuses = new Set<PlanApprovalReadiness["status"]>(["ready-for-plan-approval", "blocked-needs-plan-revision", "blocked-needs-design-revision", "failed", "stale"]);
const forbiddenKeys = new Set([
  "approved", "approval", "approve", "planApproval", "execute", "execution", "startExecution", "statePatch", "workflowState",
  "workflowStatePatch", "phase", "phaseTransition", "nextPhase", "artifactCommit", "commitArtifacts", "mutations", "gateDecision",
  "skipGate", "skipGates", "commands", "subagents", "backgroundExecution", "design", "designMd", "revisedDesign",
]);
const forbiddenText = /\b(approve\s+(?:the\s+)?plan|start\s+execution|execute\s+tasks|transition\s+to\s+execut|mutate\s+workflow\s+state|commit\s+artifact|skip\s+gate)\b/iu;

export const planReviewerOutputSchema: AgentOutputSchema<PlanReviewerOutput> = {
  name: "PlanReviewerOutput",
  parse(raw) {
    return JSON.parse(raw) as unknown;
  },
  validate(value) {
    const record = asRecord(value, "output");
    rejectUnauthorizedDirectives(record);
    return {
      summary: asSafeString(record.summary, "summary"),
      confidence: asEnum(record.confidence, new Set(["low", "medium", "high"]), "confidence"),
      findings: asFindings(record.findings),
    };
  },
};

export function validatePlanReviewFindingDraft(value: unknown, name = "finding"): PlanReviewFindingDraft {
  const record = asRecord(value, name);
  rejectUnauthorizedDirectives(record);
  const finding: PlanReviewFindingDraft = {
    severity: asEnum(record.severity, severities, `${name}.severity`),
    category: asEnum(record.category, categories, `${name}.category`),
    title: asSafeString(record.title, `${name}.title`),
    description: asSafeString(record.description, `${name}.description`),
    affectedArtifacts: asArtifactArray(record.affectedArtifacts, `${name}.affectedArtifacts`),
    affectedSections: asStringArray(record.affectedSections, `${name}.affectedSections`),
    ...(record.recommendation === undefined ? {} : { recommendation: asSafeString(record.recommendation, `${name}.recommendation`) }),
    requiresPlanRevision: asBoolean(record.requiresPlanRevision, `${name}.requiresPlanRevision`),
    requiresDesignRevision: asBoolean(record.requiresDesignRevision, `${name}.requiresDesignRevision`),
    ...(record.evidence === undefined ? {} : { evidence: asSafeString(record.evidence, `${name}.evidence`) }),
  };
  if (finding.severity === "blocking" && !finding.recommendation) throw new Error(`${name}: blocking findings must include a concrete recommendation.`);
  if (finding.requiresDesignRevision && finding.requiresPlanRevision) throw new Error(`${name}: requiresDesignRevision=true prevents automatic plan revision eligibility.`);
  return finding;
}

export function validatePlanReviewAggregate(value: unknown): PlanReviewAggregate {
  const aggregate = asRecord(value, "aggregate") as unknown as PlanReviewAggregate;
  asSafeString(aggregate.reviewRunId, "aggregate.reviewRunId");
  if (!Array.isArray(aggregate.findings)) throw new Error("aggregate.findings must be an array.");
  return aggregate;
}

export function validatePlanApprovalReadiness(value: unknown): PlanApprovalReadiness {
  const record = asRecord(value, "readiness");
  return {
    status: asEnum(record.status, readinessStatuses, "readiness.status"),
    blockingFindingIds: asStringArray(record.blockingFindingIds, "readiness.blockingFindingIds"),
    summary: asSafeString(record.summary, "readiness.summary"),
  };
}

export function validatePlanRevisionAgentOutput(value: unknown): PlanRevisionAgentOutput {
  const record = asRecord(value, "revisionOutput");
  rejectUnauthorizedDirectives(record);
  const status = asEnum(record.status, new Set<PlanRevisionAgentOutput["status"]>(["revised", "blocked"]), "revisionOutput.status");
  const output: PlanRevisionAgentOutput = {
    status,
    ...(record.revisedRequirements === undefined ? {} : { revisedRequirements: asSafeString(record.revisedRequirements, "revisionOutput.revisedRequirements") }),
    ...(record.revisedTasks === undefined ? {} : { revisedTasks: asSafeString(record.revisedTasks, "revisionOutput.revisedTasks") }),
    addressedFindingIds: asStringArray(record.addressedFindingIds, "revisionOutput.addressedFindingIds"),
    unresolvedFindingIds: asStringArray(record.unresolvedFindingIds, "revisionOutput.unresolvedFindingIds"),
    summary: asSafeString(record.summary, "revisionOutput.summary"),
    requiresDesignRevision: asBoolean(record.requiresDesignRevision, "revisionOutput.requiresDesignRevision"),
    ...(record.blockers === undefined ? {} : { blockers: asStringArray(record.blockers, "revisionOutput.blockers") }),
  };
  if (status === "revised" && (!output.revisedRequirements || !output.revisedTasks)) throw new Error("revisionOutput: revised status requires both revisedRequirements and revisedTasks.");
  if (output.requiresDesignRevision && status === "revised") throw new Error("revisionOutput: requiresDesignRevision=true prevents automatic plan revision eligibility.");
  rejectExecutionProgressMutation(output.revisedTasks);
  return output;
}

export const planRevisionAgentOutputSchema: AgentOutputSchema<PlanRevisionAgentOutput> = {
  name: "PlanRevisionAgentOutput",
  parse(raw) { return JSON.parse(raw) as unknown; },
  validate: validatePlanRevisionAgentOutput,
};

export function rejectUnauthorizedDirectives(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenKeys.has(key)) throw new Error(`Plan review output contains unauthorized directive: ${key}`);
    if (typeof child === "string" && forbiddenText.test(child)) throw new Error(`Plan review output contains unauthorized directive text in ${key}.`);
    if (child && typeof child === "object") rejectUnauthorizedDirectives(child);
  }
}

function asFindings(value: unknown): PlanReviewFindingDraft[] {
  if (!Array.isArray(value)) throw new Error("findings must be an array.");
  return value.map((item, index) => validatePlanReviewFindingDraft(item, `findings[${index}]`));
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

function asSafeString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  if (forbiddenText.test(value)) throw new Error(`${name} contains an unauthorized approval/execution/state directive.`);
  return value;
}

function asStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.trim())) throw new Error(`${name} must be an array of non-empty strings.`);
  return value;
}

function asArtifactArray(value: unknown, name: string): PlanReviewArtifactName[] {
  const result = asStringArray(value, name);
  for (const entry of result) if (!artifacts.has(entry as PlanReviewArtifactName)) throw new Error(`${name} contains unsupported artifact: ${entry}`);
  return result as PlanReviewArtifactName[];
}

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean.`);
  return value;
}

function asEnum<T extends string>(value: unknown, values: Set<T>, name: string): T {
  if (typeof value !== "string" || !values.has(value as T)) throw new Error(`${name} must be one of: ${[...values].join(", ")}.`);
  return value as T;
}

function rejectExecutionProgressMutation(tasks: string | undefined): void {
  if (!tasks) return;
  if (/^- \[(?:✅|x|X)\]/mu.test(tasks)) throw new Error("revisionOutput.revisedTasks must not mark task execution progress complete.");
}
