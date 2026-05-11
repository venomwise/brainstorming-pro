import type { FullDesignReviewerRole, ReviewMode, VersionedArtifactRef } from "../../types.ts";
import type {
  DesignRevisionAuthorization,
  DesignRevisionOutput,
  DesignRevisionPostReviewSettings,
  DesignRevisionRecord,
  DesignRevisionRequest,
  DesignRevisionRoundPolicy,
  DesignRevisionStatus,
  DesignRevisionTerminalStatus,
  DesignRevisionUserAnswer,
} from "./types.ts";

const revisionStatuses = new Set<DesignRevisionStatus>(["authorized", "started", "needs-user-input", "blocked", "failed", "committed", "revision-exhausted", "stale-source"]);
const terminalStatuses = new Set<DesignRevisionTerminalStatus>(["needs-user-input", "blocked", "failed", "committed", "revision-exhausted", "stale-source"]);
const reviewModes = new Set<Exclude<ReviewMode, "skip">>(["minimal", "full"]);
const fullReviewerRoles = new Set<FullDesignReviewerRole>(["product-reviewer", "architecture-reviewer", "risk-security-reviewer", "testing-reviewer", "scope-simplicity-reviewer"]);

const unauthorizedDirectiveKeys = new Set([
  "approved",
  "approval",
  "approve",
  "approveDesign",
  "artifactCommit",
  "artifactsToCommit",
  "commit",
  "commitArtifact",
  "commitArtifacts",
  "directArtifactCommit",
  "gateDecision",
  "generatePlan",
  "mutateArtifact",
  "mutateState",
  "mutation",
  "mutations",
  "nextPhase",
  "phase",
  "phaseTransition",
  "plan",
  "planning",
  "retry",
  "retryReviewers",
  "reviewRetry",
  "acceptIncomplete",
  "accept-incomplete",
  "state",
  "statePatch",
  "tasks",
  "workflowState",
  "workflowStatePatch",
]);

export function validateDesignRevisionAuthorization(value: unknown): DesignRevisionAuthorization {
  const record = asRecord(value, "design revision authorization");
  rejectUnauthorizedRevisionDirectives(record);
  const authorization: DesignRevisionAuthorization = {
    revisionId: asNonEmptyString(record.revisionId, "authorization.revisionId"),
    workflowRunId: asNonEmptyString(record.workflowRunId, "authorization.workflowRunId"),
    topic: asNonEmptyString(record.topic, "authorization.topic"),
    allowedAction: asLiteral(record.allowedAction, "single-revision-and-rereview", "authorization.allowedAction"),
    sourceDesignRef: asVersionedArtifactRef(record.sourceDesignRef, "authorization.sourceDesignRef"),
    sourceReviewRunId: asNonEmptyString(record.sourceReviewRunId, "authorization.sourceReviewRunId"),
    ...(record.sourceReviewRunChecksum === undefined ? {} : { sourceReviewRunChecksum: asNonEmptyString(record.sourceReviewRunChecksum, "authorization.sourceReviewRunChecksum") }),
    sourceTriageRef: asChecksumRef(record.sourceTriageRef, "authorization.sourceTriageRef"),
    sourceReadinessRef: asChecksumRef(record.sourceReadinessRef, "authorization.sourceReadinessRef"),
    ...(record.sourceCoverageRef === undefined ? {} : { sourceCoverageRef: asChecksumRef(record.sourceCoverageRef, "authorization.sourceCoverageRef") }),
    postRevisionReview: asPostReviewSettings(record.postRevisionReview, "authorization.postRevisionReview"),
    roundPolicy: asRoundPolicy(record.roundPolicy, "authorization.roundPolicy"),
    ...(record.userInstructions === undefined ? {} : { userInstructions: asNonEmptyString(record.userInstructions, "authorization.userInstructions") }),
    userAnswers: asUserAnswers(record.userAnswers, "authorization.userAnswers"),
    authorizedBy: asLiteral(record.authorizedBy, "user", "authorization.authorizedBy"),
    authorizedAt: asNonEmptyString(record.authorizedAt, "authorization.authorizedAt"),
    ...(record.consumedAt === undefined ? {} : { consumedAt: asNonEmptyString(record.consumedAt, "authorization.consumedAt") }),
  };
  if (authorization.consumedAt) throw new Error("Design revision authorization has already been consumed.");
  return authorization;
}

export function validateDesignRevisionRequest(value: unknown): DesignRevisionRequest {
  const record = asRecord(value, "design revision request");
  rejectUnauthorizedRevisionDirectives(record);
  return {
    revisionId: asNonEmptyString(record.revisionId, "request.revisionId"),
    workflowRunId: asNonEmptyString(record.workflowRunId, "request.workflowRunId"),
    topic: asNonEmptyString(record.topic, "request.topic"),
    sourceDesignRef: asVersionedArtifactRef(record.sourceDesignRef, "request.sourceDesignRef"),
    sourceReviewRunId: asNonEmptyString(record.sourceReviewRunId, "request.sourceReviewRunId"),
    sourceTriageRef: asChecksumRef(record.sourceTriageRef, "request.sourceTriageRef"),
    sourceReadinessRef: asChecksumRef(record.sourceReadinessRef, "request.sourceReadinessRef"),
    mustFixClusterIds: asStringArray(record.mustFixClusterIds, "request.mustFixClusterIds"),
    shouldFixClusterIds: asStringArray(record.shouldFixClusterIds, "request.shouldFixClusterIds"),
    conflictIds: asStringArray(record.conflictIds, "request.conflictIds"),
    unresolvedQuestionIds: asStringArray(record.unresolvedQuestionIds, "request.unresolvedQuestionIds"),
    carryForwardQuestionIds: asStringArray(record.carryForwardQuestionIds, "request.carryForwardQuestionIds"),
    userAnswers: asUserAnswers(record.userAnswers, "request.userAnswers"),
    ...(record.userInstructions === undefined ? {} : { userInstructions: asNonEmptyString(record.userInstructions, "request.userInstructions") }),
    roundPolicy: asRoundPolicy(record.roundPolicy, "request.roundPolicy"),
    postRevisionReview: asPostReviewSettings(record.postRevisionReview, "request.postRevisionReview"),
    triage: asTriageExcerpt(record.triage, "request.triage"),
    readiness: asRecord(record.readiness, "request.readiness") as DesignRevisionRequest["readiness"],
    requestedAt: asNonEmptyString(record.requestedAt, "request.requestedAt"),
  };
}

export function validateDesignRevisionOutput(value: unknown, knownItemIds?: ReadonlySet<string>): DesignRevisionOutput {
  const record = asRecord(value, "design revision output");
  rejectUnauthorizedRevisionDirectives(record);
  const output: DesignRevisionOutput = {
    revisedDesignMarkdown: asNonEmptyString(record.revisedDesignMarkdown, "output.revisedDesignMarkdown"),
    changeSummary: asStringArray(record.changeSummary, "output.changeSummary"),
    resolvedItemIds: asStringArray(record.resolvedItemIds, "output.resolvedItemIds"),
    unresolvedItemIds: asStringArray(record.unresolvedItemIds, "output.unresolvedItemIds"),
    assumptions: asStringArray(record.assumptions, "output.assumptions"),
    riskNotes: asStringArray(record.riskNotes, "output.riskNotes"),
  };
  if (knownItemIds) assertKnownIds([...output.resolvedItemIds, ...output.unresolvedItemIds], knownItemIds, "output item id");
  return output;
}

export function validateDesignRevisionRecord(value: unknown): DesignRevisionRecord {
  const record = asRecord(value, "design revision record");
  rejectUnauthorizedRevisionDirectives(record);
  return {
    revisionId: asNonEmptyString(record.revisionId, "record.revisionId"),
    workflowRunId: asNonEmptyString(record.workflowRunId, "record.workflowRunId"),
    topic: asNonEmptyString(record.topic, "record.topic"),
    status: asEnum(record.status, terminalStatuses, "record.status"),
    sourceDesignRef: asVersionedArtifactRef(record.sourceDesignRef, "record.sourceDesignRef"),
    ...(record.targetDesignRef === undefined ? {} : { targetDesignRef: asVersionedArtifactRef(record.targetDesignRef, "record.targetDesignRef") }),
    sourceReviewRunId: asNonEmptyString(record.sourceReviewRunId, "record.sourceReviewRunId"),
    sourceTriageRef: asChecksumRef(record.sourceTriageRef, "record.sourceTriageRef"),
    sourceReadinessRef: asChecksumRef(record.sourceReadinessRef, "record.sourceReadinessRef"),
    ...(record.sourceCoverageRef === undefined ? {} : { sourceCoverageRef: asChecksumRef(record.sourceCoverageRef, "record.sourceCoverageRef") }),
    ...(record.postRevisionReviewRunId === undefined ? {} : { postRevisionReviewRunId: asNonEmptyString(record.postRevisionReviewRunId, "record.postRevisionReviewRunId") }),
    resolvedItemIds: asStringArray(record.resolvedItemIds, "record.resolvedItemIds"),
    unresolvedItemIds: asStringArray(record.unresolvedItemIds, "record.unresolvedItemIds"),
    ...(record.blockingQuestionIds === undefined ? {} : { blockingQuestionIds: asStringArray(record.blockingQuestionIds, "record.blockingQuestionIds") }),
    changeSummary: asStringArray(record.changeSummary, "record.changeSummary"),
    ...(record.reason === undefined ? {} : { reason: asNonEmptyString(record.reason, "record.reason") }),
    ...(record.startedAt === undefined ? {} : { startedAt: asNonEmptyString(record.startedAt, "record.startedAt") }),
    completedAt: asNonEmptyString(record.completedAt, "record.completedAt"),
  };
}

export function rejectUnauthorizedRevisionDirectives(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (unauthorizedDirectiveKeys.has(key)) throw new Error(`Design revision payload contains unauthorized directive: ${key}`);
    if (Array.isArray(child)) {
      for (const item of child) rejectUnauthorizedRevisionDirectives(item);
    } else if (child && typeof child === "object") {
      rejectUnauthorizedRevisionDirectives(child);
    }
  }
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

function asLiteral<T extends string>(value: unknown, expected: T, name: string): T {
  if (value !== expected) throw new Error(`${name} must be ${expected}.`);
  return expected;
}

function asEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>, name: string): T {
  if (typeof value !== "string" || !allowed.has(value as T)) throw new Error(`${name} is invalid.`);
  return value as T;
}

function asNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value;
}

function asNonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value as number;
}

function asStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value.map((item, index) => asNonEmptyString(item, `${name}[${index}]`));
}

function asChecksumRef(value: unknown, name: string): { path: string; checksum: string } {
  const record = asRecord(value, name);
  rejectUnauthorizedRevisionDirectives(record);
  return { path: asNonEmptyString(record.path, `${name}.path`), checksum: asNonEmptyString(record.checksum, `${name}.checksum`) };
}

function asVersionedArtifactRef(value: unknown, name: string): VersionedArtifactRef {
  const record = asRecord(value, name);
  rejectUnauthorizedRevisionDirectives(record);
  return {
    kind: asEnum(record.kind, new Set(["design", "requirements", "tasks"]), `${name}.kind`),
    version: asNonNegativeInteger(record.version, `${name}.version`),
    path: asNonEmptyString(record.path, `${name}.path`),
    checksum: asNonEmptyString(record.checksum, `${name}.checksum`),
    createdAt: asNonEmptyString(record.createdAt, `${name}.createdAt`),
  };
}

function asUserAnswers(value: unknown, name: string): DesignRevisionUserAnswer[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value.map((item, index) => {
    const record = asRecord(item, `${name}[${index}]`);
    rejectUnauthorizedRevisionDirectives(record);
    return {
      questionId: asNonEmptyString(record.questionId, `${name}[${index}].questionId`),
      answer: asNonEmptyString(record.answer, `${name}[${index}].answer`),
      answeredBy: asLiteral(record.answeredBy, "user", `${name}[${index}].answeredBy`),
      answeredAt: asNonEmptyString(record.answeredAt, `${name}[${index}].answeredAt`),
    };
  });
}

function asRoundPolicy(value: unknown, name: string): DesignRevisionRoundPolicy {
  const record = asRecord(value, name);
  rejectUnauthorizedRevisionDirectives(record);
  const policy = {
    maxTotalRevisionRounds: asNonNegativeInteger(record.maxTotalRevisionRounds, `${name}.maxTotalRevisionRounds`),
    maxTotalPostRevisionReviewRounds: asNonNegativeInteger(record.maxTotalPostRevisionReviewRounds, `${name}.maxTotalPostRevisionReviewRounds`),
    usedRevisionRounds: asNonNegativeInteger(record.usedRevisionRounds, `${name}.usedRevisionRounds`),
    usedPostRevisionReviewRounds: asNonNegativeInteger(record.usedPostRevisionReviewRounds, `${name}.usedPostRevisionReviewRounds`),
  };
  if (policy.usedRevisionRounds > policy.maxTotalRevisionRounds) throw new Error(`${name}.usedRevisionRounds exceeds maxTotalRevisionRounds.`);
  if (policy.usedPostRevisionReviewRounds > policy.maxTotalPostRevisionReviewRounds) throw new Error(`${name}.usedPostRevisionReviewRounds exceeds maxTotalPostRevisionReviewRounds.`);
  return policy;
}

function asPostReviewSettings(value: unknown, name: string): DesignRevisionPostReviewSettings {
  const record = asRecord(value, name);
  rejectUnauthorizedRevisionDirectives(record);
  return {
    mode: asEnum(record.mode, reviewModes, `${name}.mode`),
    ...(record.selectedReviewerRoles === undefined ? {} : { selectedReviewerRoles: asFullReviewerRoles(record.selectedReviewerRoles, `${name}.selectedReviewerRoles`) }),
  };
}

function asFullReviewerRoles(value: unknown, name: string): FullDesignReviewerRole[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value.map((item, index) => asEnum(item, fullReviewerRoles, `${name}[${index}]`));
}

function asTriageExcerpt(value: unknown, name: string): DesignRevisionRequest["triage"] {
  const record = asRecord(value, name);
  rejectUnauthorizedRevisionDirectives(record);
  return {
    summary: asNonEmptyString(record.summary, `${name}.summary`),
    clusters: Array.isArray(record.clusters) ? record.clusters as DesignRevisionRequest["triage"]["clusters"] : fail(`${name}.clusters must be an array.`),
    conflicts: Array.isArray(record.conflicts) ? record.conflicts as DesignRevisionRequest["triage"]["conflicts"] : fail(`${name}.conflicts must be an array.`),
    unresolvedQuestions: Array.isArray(record.unresolvedQuestions) ? record.unresolvedQuestions as DesignRevisionRequest["triage"]["unresolvedQuestions"] : fail(`${name}.unresolvedQuestions must be an array.`),
  };
}

function assertKnownIds(ids: string[], knownItemIds: ReadonlySet<string>, name: string): void {
  for (const id of ids) {
    if (!knownItemIds.has(id)) throw new Error(`${name} references unknown id: ${id}`);
  }
}

function fail(message: string): never {
  throw new Error(message);
}
