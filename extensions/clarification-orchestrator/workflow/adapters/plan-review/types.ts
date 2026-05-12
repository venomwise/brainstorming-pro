import type { AgentRunError, ProviderQualifiedModel } from "../../../runtime/agent-execution/types.ts";
import type { VersionedArtifactRef } from "../../types.ts";

export type PlanReviewerRole = "requirements-coverage-reviewer" | "task-coverage-reviewer" | "dependency-order-reviewer";

export type PlanReviewArtifactName = "design" | "requirements" | "tasks";

export type PlanReviewArtifactBinding = {
  design: VersionedArtifactRef;
  requirements: VersionedArtifactRef;
  tasks: VersionedArtifactRef;
  approvedDesignRef: VersionedArtifactRef;
  createdAt: string;
};

export type PlanReviewFindingSeverity = "blocking" | "major" | "minor" | "note";
export type PlanReviewFindingCategory =
  | "requirements-coverage"
  | "task-coverage"
  | "dependency-order"
  | "artifact-format"
  | "missing-validation"
  | "scope-creep"
  | "consistency"
  | "trust-boundary";

export type PlanReviewFindingDraft = {
  severity: PlanReviewFindingSeverity;
  category: PlanReviewFindingCategory;
  title: string;
  description: string;
  affectedArtifacts: PlanReviewArtifactName[];
  affectedSections: string[];
  recommendation?: string;
  requiresPlanRevision: boolean;
  requiresDesignRevision: boolean;
  evidence?: string;
};

export type PlanReviewFinding = PlanReviewFindingDraft & {
  id: string;
  reviewRunId: string;
  reviewerRole: PlanReviewerRole | "shape-validator";
  artifactBinding: PlanReviewArtifactBinding;
};

export type PlanReviewerOutput = {
  summary: string;
  findings: PlanReviewFindingDraft[];
  confidence: "low" | "medium" | "high";
};

export type PlanReviewerResult = {
  reviewRunId: string;
  reviewerRole: PlanReviewerRole;
  status: "succeeded" | "failed";
  summary?: string;
  findings: PlanReviewFinding[];
  rawOutput?: unknown;
  error?: AgentRunError;
  startedAt: string;
  completedAt: string;
};

export type PlanReviewAggregate = {
  reviewRunId: string;
  artifactBinding: PlanReviewArtifactBinding;
  findings: PlanReviewFinding[];
  reviewerResults: Array<{ reviewerRole: PlanReviewerRole; status: "succeeded" | "failed"; error?: AgentRunError }>;
  counts: {
    blocking: number;
    major: number;
    minor: number;
    note: number;
    requiresPlanRevision: number;
    requiresDesignRevision: number;
  };
};

export type PlanApprovalReadiness = {
  status: "ready-for-plan-approval" | "blocked-needs-plan-revision" | "blocked-needs-design-revision" | "failed" | "stale";
  blockingFindingIds: string[];
  summary: string;
};

export type PlanReviewRun = {
  reviewRunId: string;
  topic: string;
  workflowRunId: string;
  status: "created" | "running" | "aggregated" | "ready" | "blocked" | "failed" | "stale";
  artifactBinding: PlanReviewArtifactBinding;
  ledgerPath: string;
  startedAt: string;
  completedAt?: string;
  reviewerResults: Array<{ reviewerRole: PlanReviewerRole; path: string; status: "succeeded" | "failed" }>;
  aggregate?: PlanReviewAggregate;
  readiness?: PlanApprovalReadiness;
  error?: AgentRunError;
};

export type PlanReviewPanelRequest = {
  topic: string;
  workflowRunId: string;
  projectRoot: string;
  topicDir: string;
  state: { artifacts: Partial<Record<"design" | "requirements" | "tasks", VersionedArtifactRef>>; gates: { design?: { artifacts: VersionedArtifactRef[] } } };
  model: ProviderQualifiedModel;
};

export type PlanReviewPanelResult = {
  reviewRunId: string;
  status: "passed" | "blocked" | "failed";
  readiness: PlanApprovalReadiness;
  aggregate?: PlanReviewAggregate;
  ledgerPath: string;
  artifactBinding?: PlanReviewArtifactBinding;
  error?: AgentRunError;
};

export type PlanRevisionPolicy = {
  revisionId: string;
  sourceReviewRunId: string;
  usedForPlanCycle: boolean;
  eligible: boolean;
  reason?: string;
};

export type PlanRevisionAgentOutput = {
  status: "revised" | "blocked";
  revisedRequirements?: string;
  revisedTasks?: string;
  addressedFindingIds: string[];
  unresolvedFindingIds: string[];
  summary: string;
  requiresDesignRevision: boolean;
  blockers?: string[];
};
