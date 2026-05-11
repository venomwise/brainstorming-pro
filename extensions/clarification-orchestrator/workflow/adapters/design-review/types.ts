import type { ProviderQualifiedModel } from "../../../runtime/agent-execution/types.ts";
import type { VersionedArtifactRef } from "../../types.ts";

export type DesignReviewMode = "skip" | "minimal" | "full";
export type DesignReviewPanelStatus = "skipped" | "passed" | "blocked" | "failed" | "partial" | "unavailable";
export type DesignReviewRunStatus = "created" | "running" | "collecting" | "aggregated" | DesignReviewPanelStatus;
export type DesignReviewUnavailableReason = "full-review-unavailable" | "reviewer-role-pack-missing";
export type DesignReviewSkipReason = "user-selected-skip";

export type FullDesignReviewerRole =
  | "product-reviewer"
  | "architecture-reviewer"
  | "risk-security-reviewer"
  | "testing-reviewer"
  | "scope-simplicity-reviewer";

export type DesignReviewerRole =
  | "minimal-reviewer"
  | FullDesignReviewerRole;

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

export type DesignReviewerOutput = {
  summary: string;
  findings: DesignReviewFindingDraft[];
  confidence: "low" | "medium" | "high";
};

export type MinimalDesignReviewOutput = DesignReviewerOutput;

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
  status: "ready-for-user-approval" | "blocked" | "failed" | "not-ready" | "skipped-by-user" | "incomplete-review";
  blockingFindingIds: string[];
  unresolvedUserQuestions: string[];
  summary: string;
};

export type DesignReviewCoverage = {
  availableReviewers: FullDesignReviewerRole[];
  selectedReviewers: FullDesignReviewerRole[];
  unselectedReviewers: FullDesignReviewerRole[];
  succeededReviewers: FullDesignReviewerRole[];
  failedReviewers: FullDesignReviewerRole[];
  pendingRetryReviewers: FullDesignReviewerRole[];
};

export type DesignReviewAttempt = {
  attemptId: string;
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  reviewerRoles: FullDesignReviewerRole[];
  reason: "initial" | "retry-failed-reviewers";
  status: "started" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  succeededReviewers: FullDesignReviewerRole[];
  failedReviewers: FullDesignReviewerRole[];
};

export type AcceptIncompleteDesignReviewDecision = {
  decisionId: string;
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  acceptedCoverage: DesignReviewCoverage;
  successfulResultRefs: string[];
  failedDiagnosticRefs: string[];
  aggregateRef: string;
  decidedBy: "user";
  reason?: string;
  decidedAt: string;
};

export type DesignReviewRecoveryAction =
  | { type: "retry-failed-reviewers"; reviewRunId: string; reviewerRoles: FullDesignReviewerRole[] }
  | { type: "accept-incomplete-review"; reviewRunId: string; designRef: VersionedArtifactRef; coverage: DesignReviewCoverage }
  | { type: "replace-review-selection"; designRef: VersionedArtifactRef; availableReviewerRoles: FullDesignReviewerRole[] }
  | { type: "revise-design-once"; reviewRunId: string; designRef: VersionedArtifactRef; blockingQuestionIds?: string[]; ledgerPath: string }
  | { type: "answer-design-revision-questions"; reviewRunId: string; designRef: VersionedArtifactRef; questionIds: string[] }
  | { type: "post-revision-handoff"; revisionId: string; revisedDesignRef: VersionedArtifactRef; postRevisionReviewRunId: string; readinessStatus?: string; triageSummary?: string }
  | { type: "view-review-ledger"; reviewRunId: string; ledgerPath: string };

export type DesignReviewAggregateResult = {
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  status: DesignReviewPanelStatus;
  summary: string;
  counts: DesignReviewCounts;
  findings: DesignReviewFinding[];
  readiness: DesignApprovalReadiness;
  coverage?: DesignReviewCoverage;
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
  triage?: DesignReviewTriageReport;
  readiness: DesignApprovalReadiness;
  enhancedReadiness?: DesignReviewReadinessReport;
  triageSummary?: string;
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

export type DesignReviewTriageLevel = "must-fix" | "should-fix" | "note";
export type DesignReviewConflictType = "recommendation-conflict" | "severity-disagreement" | "scope-disagreement" | "readiness-disagreement";
export type DesignReviewConflictImpact = "blocking-approval-readiness" | "requires-resolution-before-revision" | "informational";
export type DesignReviewRecommendedNextAction = "revise-design" | "resolve-user-questions" | "approve-design" | "accept-incomplete-or-retry" | "inspect-failure-or-retry" | "review-summary";
export type DesignReviewTriageReportStatus = "fresh" | "stale" | "invalid" | "failed";

export type DesignReviewTriageReviewerResultRef = {
  reviewerRole: DesignReviewerRole;
  path: string;
  checksum: string;
  status: "succeeded" | "failed";
};

export type DesignReviewTriageSourceRefs = {
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  aggregate: {
    path: string;
    checksum: string;
  };
  coverage?: {
    path: string;
    checksum: string;
  };
  reviewerResults: DesignReviewTriageReviewerResultRef[];
  reviewDecisionRef?: string;
};

export type DesignReviewFindingCluster = {
  clusterId: string;
  triageLevel: DesignReviewTriageLevel;
  sourceFindingIds: string[];
  reviewerRoles: DesignReviewTriageReviewerResultRef["reviewerRole"][];
  category: DesignReviewFindingCategory;
  severity: DesignReviewFindingSeverity;
  requiresRevision: boolean;
  title: string;
  description: string;
  evidence?: string[];
  affectedSections: string[];
  recommendations: string[];
  userQuestions: string[];
};

export type DesignReviewConflict = {
  conflictId: string;
  type: DesignReviewConflictType;
  impact: DesignReviewConflictImpact;
  sourceFindingIds: string[];
  clusterIds: string[];
  reviewerRoles: DesignReviewTriageReviewerResultRef["reviewerRole"][];
  summary: string;
  details: string;
};

export type DesignReviewUnresolvedQuestion = {
  questionId: string;
  question: string;
  blocking: boolean;
  sourceFindingIds: string[];
  clusterIds: string[];
  reviewerRoles: DesignReviewTriageReviewerResultRef["reviewerRole"][];
  relatedSections: string[];
};

export type DesignReviewCoverageSummary = DesignReviewCoverage & {
  status: "complete" | "incomplete" | "unavailable";
  hasIncompleteCoverage: boolean;
};

export type DesignReviewReadinessReport = {
  status: DesignApprovalReadiness["status"];
  sourceReadiness: DesignApprovalReadiness;
  recommendedNextAction: DesignReviewRecommendedNextAction;
  blockingFindingIds: string[];
  blockingConflictIds: string[];
  blockingQuestionIds: string[];
  summary: string;
};

export type DesignReviewTriageEngineInput = {
  reviewRun: DesignReviewRun;
  aggregate: DesignReviewAggregateResult;
  findings: DesignReviewFinding[];
  coverage?: DesignReviewCoverage;
  currentReadiness?: DesignApprovalReadiness;
  sources: DesignReviewTriageSourceRefs;
};

export type DesignReviewTriageReport = {
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  status: DesignReviewTriageReportStatus;
  generatedAt: string;
  sources: DesignReviewTriageSourceRefs;
  findings: DesignReviewFinding[];
  clusters: DesignReviewFindingCluster[];
  conflicts: DesignReviewConflict[];
  unresolvedQuestions: DesignReviewUnresolvedQuestion[];
  coverage: DesignReviewCoverageSummary;
  readiness: DesignReviewReadinessReport;
  summary: string;
};

export type DesignRevisionRequestInput = {
  designRef: VersionedArtifactRef;
  reviewRunId: string;
  blockingFindings: DesignReviewFinding[];
  readiness: DesignApprovalReadiness;
};
