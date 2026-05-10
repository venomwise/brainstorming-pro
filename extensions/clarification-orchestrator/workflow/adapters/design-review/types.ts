import type { ProviderQualifiedModel } from "../../../runtime/agent-execution/types.ts";
import type { VersionedArtifactRef } from "../../types.ts";

export type DesignReviewMode = "skip" | "minimal" | "full";
export type DesignReviewPanelStatus = "skipped" | "passed" | "blocked" | "failed" | "unavailable";
export type DesignReviewRunStatus = "created" | "running" | "collecting" | "aggregated" | DesignReviewPanelStatus;
export type DesignReviewUnavailableReason = "full-review-unavailable" | "reviewer-role-pack-missing";
export type DesignReviewSkipReason = "user-selected-skip";

export type DesignReviewerRole =
  | "minimal-reviewer"
  | "product-reviewer"
  | "architecture-reviewer"
  | "risk-security-reviewer"
  | "testing-reviewer"
  | "scope-simplicity-reviewer";

export type DesignReviewFindingCategory = "product" | "architecture" | "risk-security" | "testing" | "scope-simplicity" | "consistency" | "missing-context";
export type DesignReviewFindingSeverity = "blocking" | "non-blocking" | "note";

export type DesignReviewFindingDraft = {
  category: DesignReviewFindingCategory;
  severity: DesignReviewFindingSeverity;
  title: string;
  description: string;
  evidence?: string;
  affectedSections?: string[];
  recommendation?: string;
  requiresRevision: boolean;
  userQuestion?: string;
};

export type DesignReviewFinding = DesignReviewFindingDraft & {
  id: string;
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  reviewerRole: DesignReviewerRole;
};

export type MinimalDesignReviewOutput = {
  summary: string;
  findings: DesignReviewFindingDraft[];
  confidence: "low" | "medium" | "high";
};

export type DesignReviewerResult = {
  reviewRunId: string;
  reviewerRole: DesignReviewerRole;
  status: "succeeded" | "failed";
  summary?: string;
  findings: DesignReviewFinding[];
  rawOutput?: unknown;
  error?: { kind: string; message: string; retryable: boolean; details?: unknown };
  startedAt: string;
  completedAt: string;
};

export type DesignReviewCounts = {
  blocking: number;
  nonBlocking: number;
  notes: number;
  byCategory: Record<string, number>;
  byReviewer: Record<string, number>;
};

export type DesignApprovalReadiness = {
  status: "ready-for-user-approval" | "blocked" | "failed" | "not-ready" | "skipped-by-user";
  blockingFindingIds: string[];
  unresolvedUserQuestions: string[];
  summary: string;
};

export type DesignReviewAggregateResult = {
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  status: DesignReviewPanelStatus;
  summary: string;
  counts: DesignReviewCounts;
  findings: DesignReviewFinding[];
  readiness: DesignApprovalReadiness;
};

export type DesignReviewRun = {
  reviewRunId: string;
  topic: string;
  workflowRunId: string;
  mode: DesignReviewMode;
  status: DesignReviewRunStatus;
  designRef: VersionedArtifactRef;
  reviewDecisionRef: string;
  ledgerPath: string;
  startedAt: string;
  completedAt?: string;
  reviewerResults: Array<{ reviewerRole: DesignReviewerRole; path: string; status: "succeeded" | "failed" }>;
  aggregateResult?: DesignReviewAggregateResult;
  readiness?: DesignApprovalReadiness;
  unavailableReason?: DesignReviewUnavailableReason;
  skipReason?: DesignReviewSkipReason;
  error?: { kind: string; message: string; retryable: boolean; details?: unknown };
};

export type DesignReviewPanelRequest = {
  topic: string;
  workflowRunId: string;
  mode: DesignReviewMode;
  designRef: VersionedArtifactRef;
  reviewDecisionRef: string;
  projectRoot: string;
  topicDir: string;
  model: ProviderQualifiedModel;
};

export type DesignReviewPanelResult = {
  reviewRunId: string;
  mode: DesignReviewMode;
  status: DesignReviewPanelStatus;
  designRef: VersionedArtifactRef;
  aggregate?: DesignReviewAggregateResult;
  readiness: DesignApprovalReadiness;
  ledgerPath: string;
  unavailableReason?: DesignReviewUnavailableReason;
  reason?: DesignReviewSkipReason;
  error?: { kind: string; message: string; retryable: boolean; details?: unknown };
};

export type FullDesignReviewerRegistration = {
  role: Exclude<DesignReviewerRole, "minimal-reviewer">;
  promptBuilder: (input: { designRef: VersionedArtifactRef; designContent: string }) => { prompt: string; systemPrompt: string };
};

export type DesignReviewTriageInput = {
  reviewRun: DesignReviewRun;
  aggregate: DesignReviewAggregateResult;
  findings: DesignReviewFinding[];
};

export type DesignReviewReadinessRefinementInput = DesignReviewTriageInput & {
  currentReadiness: DesignApprovalReadiness;
};

export type DesignRevisionRequestInput = {
  designRef: VersionedArtifactRef;
  reviewRunId: string;
  blockingFindings: DesignReviewFinding[];
  readiness: DesignApprovalReadiness;
};
