import type {
  DesignReviewConflict,
  DesignReviewConflictImpact,
  DesignReviewConflictType,
  DesignReviewCoverageSummary,
  DesignReviewFinding,
  DesignReviewFindingCategory,
  DesignReviewFindingCluster,
  DesignReviewFindingSeverity,
  DesignReviewRecommendedNextAction,
  DesignReviewReadinessReport,
  DesignReviewTriageLevel,
  DesignReviewTriageReport,
  DesignReviewTriageReportStatus,
  DesignReviewUnresolvedQuestion,
  FullDesignReviewerRole,
} from "./types.ts";
import type { ArtifactKind, VersionedArtifactRef } from "../../types.ts";

const triageLevels = new Set<DesignReviewTriageLevel>(["must-fix", "should-fix", "note"]);
const conflictTypes = new Set<DesignReviewConflictType>(["recommendation-conflict", "severity-disagreement", "scope-disagreement", "readiness-disagreement"]);
const conflictImpacts = new Set<DesignReviewConflictImpact>(["blocking-approval-readiness", "requires-resolution-before-revision", "informational"]);
const reportStatuses = new Set<DesignReviewTriageReportStatus>(["fresh", "stale", "invalid", "failed"]);
const nextActions = new Set<DesignReviewRecommendedNextAction>(["revise-design", "resolve-user-questions", "approve-design", "accept-incomplete-or-retry", "inspect-failure-or-retry", "review-summary"]);
const reviewerRoles = new Set<FullDesignReviewerRole>(["product-reviewer", "architecture-reviewer", "risk-security-reviewer", "testing-reviewer", "scope-simplicity-reviewer"]);
const allReviewerRoles = new Set<DesignReviewFinding["reviewerRole"]>(["minimal-reviewer", ...reviewerRoles] as DesignReviewFinding["reviewerRole"][]);
const forbiddenKeys = new Set([
  "approved",
  "approval",
  "approve",
  "approveDesign",
  "artifacts",
  "artifactCommit",
  "commitArtifacts",
  "gateDecision",
  "planning",
  "plan",
  "phase",
  "phaseTransition",
  "nextPhase",
  "retry",
  "retryReviewers",
  "acceptIncomplete",
  "accept-incomplete",
  "state",
  "statePatch",
  "workflowState",
  "workflowStatePatch",
  "mutation",
  "mutations",
  "artifactMutation",
]);

export function validateDesignReviewTriageReport(value: unknown): DesignReviewTriageReport {
  const record = asRecord(value, "triage report");
  rejectUnauthorizedTriageDirectives(record);
  const findings = asArray(record.findings, "triage report.findings").map((finding, index) => validateDesignReviewFinding(finding, `triage report.findings[${index}]`));
  const clusters = asArray(record.clusters, "triage report.clusters").map((cluster, index) => validateDesignReviewFindingCluster(cluster, `triage report.clusters[${index}]`));
  validateClusterReferences(clusters, findings);
  return {
    reviewRunId: asNonEmptyString(record.reviewRunId, "triage report.reviewRunId"),
    designRef: asVersionedArtifactRef(record.designRef, "triage report.designRef"),
    status: asEnum(record.status, reportStatuses, "triage report.status"),
    generatedAt: asNonEmptyString(record.generatedAt, "triage report.generatedAt"),
    sources: asSources(record.sources),
    findings,
    clusters,
    conflicts: asArray(record.conflicts, "triage report.conflicts").map((conflict, index) => validateDesignReviewConflict(conflict, `triage report.conflicts[${index}]`)),
    unresolvedQuestions: asArray(record.unresolvedQuestions, "triage report.unresolvedQuestions").map((question, index) => validateDesignReviewUnresolvedQuestion(question, `triage report.unresolvedQuestions[${index}]`)),
    coverage: validateDesignReviewCoverageSummary(record.coverage),
    readiness: validateDesignReviewReadinessReport(record.readiness),
    summary: asNonEmptyString(record.summary, "triage report.summary"),
  };
}

export function validateDesignReviewFindingCluster(value: unknown, name = "finding cluster"): DesignReviewFindingCluster {
  const record = asRecord(value, name);
  rejectUnauthorizedTriageDirectives(record);
  return {
    clusterId: asNonEmptyString(record.clusterId, `${name}.clusterId`),
    triageLevel: asEnum(record.triageLevel, triageLevels, `${name}.triageLevel`),
    sourceFindingIds: asStringArray(record.sourceFindingIds, `${name}.sourceFindingIds`),
    reviewerRoles: asReviewerRoleArray(record.reviewerRoles, `${name}.reviewerRoles`),
    category: asFindingCategory(record.category, `${name}.category`),
    severity: asFindingSeverity(record.severity, `${name}.severity`),
    requiresRevision: asBoolean(record.requiresRevision, `${name}.requiresRevision`),
    title: asNonEmptyString(record.title, `${name}.title`),
    description: asNonEmptyString(record.description, `${name}.description`),
    ...(record.evidence === undefined ? {} : { evidence: asStringArray(record.evidence, `${name}.evidence`) }),
    affectedSections: asStringArray(record.affectedSections, `${name}.affectedSections`),
    recommendations: asStringArray(record.recommendations, `${name}.recommendations`),
    userQuestions: asStringArray(record.userQuestions, `${name}.userQuestions`),
  };
}

export function validateDesignReviewConflict(value: unknown, name = "conflict"): DesignReviewConflict {
  const record = asRecord(value, name);
  rejectUnauthorizedTriageDirectives(record);
  return {
    conflictId: asNonEmptyString(record.conflictId, `${name}.conflictId`),
    type: asEnum(record.type, conflictTypes, `${name}.type`),
    impact: asEnum(record.impact, conflictImpacts, `${name}.impact`),
    sourceFindingIds: asStringArray(record.sourceFindingIds, `${name}.sourceFindingIds`),
    clusterIds: asStringArray(record.clusterIds, `${name}.clusterIds`),
    reviewerRoles: asReviewerRoleArray(record.reviewerRoles, `${name}.reviewerRoles`),
    summary: asNonEmptyString(record.summary, `${name}.summary`),
    details: asNonEmptyString(record.details, `${name}.details`),
  };
}

export function validateDesignReviewUnresolvedQuestion(value: unknown, name = "unresolved question"): DesignReviewUnresolvedQuestion {
  const record = asRecord(value, name);
  rejectUnauthorizedTriageDirectives(record);
  return {
    questionId: asNonEmptyString(record.questionId, `${name}.questionId`),
    question: asNonEmptyString(record.question, `${name}.question`),
    blocking: asBoolean(record.blocking, `${name}.blocking`),
    sourceFindingIds: asStringArray(record.sourceFindingIds, `${name}.sourceFindingIds`),
    clusterIds: asStringArray(record.clusterIds, `${name}.clusterIds`),
    reviewerRoles: asReviewerRoleArray(record.reviewerRoles, `${name}.reviewerRoles`),
    relatedSections: asStringArray(record.relatedSections, `${name}.relatedSections`),
  };
}

export function validateDesignReviewCoverageSummary(value: unknown): DesignReviewCoverageSummary {
  const record = asRecord(value, "coverage summary");
  rejectUnauthorizedTriageDirectives(record);
  return {
    availableReviewers: asFullDesignReviewerRoleArray(record.availableReviewers, "coverage summary.availableReviewers"),
    selectedReviewers: asFullDesignReviewerRoleArray(record.selectedReviewers, "coverage summary.selectedReviewers"),
    unselectedReviewers: asFullDesignReviewerRoleArray(record.unselectedReviewers, "coverage summary.unselectedReviewers"),
    succeededReviewers: asFullDesignReviewerRoleArray(record.succeededReviewers, "coverage summary.succeededReviewers"),
    failedReviewers: asFullDesignReviewerRoleArray(record.failedReviewers, "coverage summary.failedReviewers"),
    pendingRetryReviewers: asFullDesignReviewerRoleArray(record.pendingRetryReviewers, "coverage summary.pendingRetryReviewers"),
    status: asEnum(record.status, new Set(["complete", "incomplete", "unavailable"]), "coverage summary.status"),
    hasIncompleteCoverage: asBoolean(record.hasIncompleteCoverage, "coverage summary.hasIncompleteCoverage"),
  };
}

export function validateDesignReviewReadinessReport(value: unknown): DesignReviewReadinessReport {
  const record = asRecord(value, "readiness report");
  rejectUnauthorizedTriageDirectives(record);
  return {
    status: asEnum(record.status, new Set(["ready-for-user-approval", "blocked", "failed", "not-ready", "skipped-by-user", "incomplete-review"]), "readiness report.status"),
    sourceReadiness: asReadiness(record.sourceReadiness, "readiness report.sourceReadiness"),
    recommendedNextAction: asEnum(record.recommendedNextAction, nextActions, "readiness report.recommendedNextAction"),
    blockingFindingIds: asStringArray(record.blockingFindingIds, "readiness report.blockingFindingIds"),
    blockingConflictIds: asStringArray(record.blockingConflictIds, "readiness report.blockingConflictIds"),
    blockingQuestionIds: asStringArray(record.blockingQuestionIds, "readiness report.blockingQuestionIds"),
    summary: asNonEmptyString(record.summary, "readiness report.summary"),
  };
}

export function validateDesignReviewFinding(value: unknown, name = "finding"): DesignReviewFinding {
  const record = asRecord(value, name);
  rejectUnauthorizedTriageDirectives(record);
  return {
    id: asNonEmptyString(record.id, `${name}.id`),
    reviewRunId: asNonEmptyString(record.reviewRunId, `${name}.reviewRunId`),
    designRef: asVersionedArtifactRef(record.designRef, `${name}.designRef`),
    reviewerRole: asReviewerRole(record.reviewerRole, `${name}.reviewerRole`),
    category: asFindingCategory(record.category, `${name}.category`),
    severity: asFindingSeverity(record.severity, `${name}.severity`),
    title: asNonEmptyString(record.title, `${name}.title`),
    description: asNonEmptyString(record.description, `${name}.description`),
    ...(record.evidence === undefined ? {} : { evidence: asNonEmptyString(record.evidence, `${name}.evidence`) }),
    ...(record.affectedSections === undefined ? {} : { affectedSections: asStringArray(record.affectedSections, `${name}.affectedSections`) }),
    ...(record.recommendation === undefined ? {} : { recommendation: asNonEmptyString(record.recommendation, `${name}.recommendation`) }),
    requiresRevision: asBoolean(record.requiresRevision, `${name}.requiresRevision`),
    ...(record.userQuestion === undefined ? {} : { userQuestion: asNonEmptyString(record.userQuestion, `${name}.userQuestion`) }),
  };
}

export function rejectUnauthorizedTriageDirectives(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (forbiddenKeys.has(key)) throw new Error(`Triage report contains unauthorized directive: ${key}`);
  }
}

function asSources(value: unknown): DesignReviewTriageReport["sources"] {
  const record = asRecord(value, "triage report.sources");
  rejectUnauthorizedTriageDirectives(record);
  return {
    reviewRunId: asNonEmptyString(record.reviewRunId, "triage report.sources.reviewRunId"),
    designRef: asVersionedArtifactRef(record.designRef, "triage report.sources.designRef"),
    aggregate: asChecksumRef(record.aggregate, "triage report.sources.aggregate"),
    ...(record.coverage === undefined ? {} : { coverage: asChecksumRef(record.coverage, "triage report.sources.coverage") }),
    reviewerResults: asArray(record.reviewerResults, "triage report.sources.reviewerResults").map((entry, index) => validateTriageReviewerResultRef(entry, `triage report.sources.reviewerResults[${index}]`)),
    ...(record.reviewDecisionRef === undefined ? {} : { reviewDecisionRef: asNonEmptyString(record.reviewDecisionRef, "triage report.sources.reviewDecisionRef") }),
  };
}

function validateTriageReviewerResultRef(value: unknown, name: string): DesignReviewTriageReport["sources"]["reviewerResults"][number] {
  const record = asRecord(value, name);
  rejectUnauthorizedTriageDirectives(record);
  return {
    reviewerRole: asReviewerRole(record.reviewerRole, `${name}.reviewerRole`),
    path: asNonEmptyString(record.path, `${name}.path`),
    checksum: asNonEmptyString(record.checksum, `${name}.checksum`),
    status: asEnum(record.status, new Set(["succeeded", "failed"]), `${name}.status`),
  };
}

function asChecksumRef(value: unknown, name: string): { path: string; checksum: string } {
  const record = asRecord(value, name);
  rejectUnauthorizedTriageDirectives(record);
  return {
    path: asNonEmptyString(record.path, `${name}.path`),
    checksum: asNonEmptyString(record.checksum, `${name}.checksum`),
  };
}

function validateClusterReferences(clusters: DesignReviewFindingCluster[], findings: DesignReviewFinding[]): void {
  const findingIds = new Set(findings.map((finding) => finding.id));
  for (const cluster of clusters) {
    for (const sourceFindingId of cluster.sourceFindingIds) {
      if (!findingIds.has(sourceFindingId)) throw new Error(`triage report cluster references unknown finding id: ${sourceFindingId}`);
    }
  }
}

function asReadiness(value: unknown, name: string): DesignReviewReadinessReport["sourceReadiness"] {
  const record = asRecord(value, name);
  rejectUnauthorizedTriageDirectives(record);
  return {
    status: asEnum(record.status, new Set(["ready-for-user-approval", "blocked", "failed", "not-ready", "skipped-by-user", "incomplete-review"]), `${name}.status`),
    blockingFindingIds: asStringArray(record.blockingFindingIds, `${name}.blockingFindingIds`),
    unresolvedUserQuestions: asStringArray(record.unresolvedUserQuestions, `${name}.unresolvedUserQuestions`),
    summary: asNonEmptyString(record.summary, `${name}.summary`),
  };
}

function asVersionedArtifactRef(value: unknown, name: string): VersionedArtifactRef {
  const record = asRecord(value, name);
  rejectUnauthorizedTriageDirectives(record);
  return {
    kind: asEnum(record.kind, new Set<ArtifactKind>(["design", "requirements", "tasks"]), `${name}.kind`),
    version: asNumber(record.version, `${name}.version`),
    path: asNonEmptyString(record.path, `${name}.path`),
    checksum: asNonEmptyString(record.checksum, `${name}.checksum`),
    createdAt: asNonEmptyString(record.createdAt, `${name}.createdAt`),
  };
}

function asFindingCategory(value: unknown, name: string): DesignReviewFindingCategory {
  return asEnum(value, new Set(["product", "architecture", "risk-security", "testing", "scope-simplicity", "consistency", "missing-context"]), name);
}

function asFindingSeverity(value: unknown, name: string): DesignReviewFindingSeverity {
  return asEnum(value, new Set(["blocking", "non-blocking", "note"]), name);
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

function asArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value;
}

function asStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.trim())) throw new Error(`${name} must be an array of non-empty strings.`);
  return value;
}

function asFullDesignReviewerRoleArray(value: unknown, name: string): FullDesignReviewerRole[] {
  return asStringArray(value, name).map((entry) => asFullDesignReviewerRole(entry, name));
}

function asFullDesignReviewerRole(value: string, name: string): FullDesignReviewerRole {
  return asEnum(value, reviewerRoles, name);
}

function asReviewerRoleArray(value: unknown, name: string): DesignReviewFinding["reviewerRole"][] {
  return asStringArray(value, name).map((entry) => asReviewerRole(entry, name));
}

function asReviewerRole(value: unknown, name: string): DesignReviewFinding["reviewerRole"] {
  return asEnum(value, allReviewerRoles, name);
}

function asNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value;
}

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean.`);
  return value;
}

function asNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  return value;
}

function asEnum<T extends string>(value: unknown, values: Set<T>, name: string): T {
  if (typeof value !== "string" || !values.has(value as T)) throw new Error(`${name} must be one of: ${[...values].join(", ")}.`);
  return value as T;
}
