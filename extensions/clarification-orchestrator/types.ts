export type AutomationMode = "manual" | "hybrid" | "auto";
export type IssueSeverity = "P0" | "P1" | "P2" | "P3";
export type IssueConfidence = "high" | "medium" | "low";
export type EstimatedCost = "low" | "medium" | "high";
export type DecisionState = "accept" | "reject" | "defer" | "discuss" | "needs-discussion";
export type VerificationStatus = "completed" | "partially-completed" | "missing" | "over-implemented";

export type ResumeStatus =
  | "awaiting-topic-confirmation"
  | "awaiting-design-gate-decision"
  | "awaiting-issue-decisions"
  | "in-cross-review"
  | "recoverable-failure"
  | "completed";

export type DesignGateAction = "approve" | "review" | "revise" | "save";

export type DesignGateDecision = {
  id: string;
  version: number;
  action: DesignGateAction;
  reason?: string;
  createdAt: string;
};

export type TopicCandidateStrength = "strong" | "weak" | "duplicate" | "unsafe";

export type TopicCandidate = {
  slug: string;
  displayName: string;
  sourcePhrase: string;
  language?: string;
  gloss?: string;
  strength: TopicCandidateStrength;
  warnings: string[];
  exactConflict?: boolean;
  similarTopics?: string[];
};

export type CrossReviewReviewerStatus = "queued" | "running" | "succeeded" | "failed" | "retrying";

export type CrossReviewProgress = {
  round: number;
  quorumRequired: number;
  quorumSucceeded: number;
  reviewers: Array<{
    name: string;
    status: CrossReviewReviewerStatus;
    attempt: number;
    startedAt?: string;
    updatedAt?: string;
    completedAt?: string;
    issueCount?: number;
    artifactPath?: string;
    error?: WorkflowError;
  }>;
  updatedAt: string;
};

export type LifecycleMethodologyVersions = {
  brainstorming: "brainstorming-pro-v1" | string;
  specPlan?: "spec-plan-pro-v1" | string;
  specExec?: "spec-exec-pro-v1" | string;
};

export type DesignVersionMetadata = {
  version: number;
  designPath: string;
  discoveryPath?: string;
  revisionPath?: string;
  changeSummary?: string;
  methodologyVersions: LifecycleMethodologyVersions;
  createdAt: string;
};
export type AgentRole =
  | "designer"
  | "reviewer"
  | "triager"
  | "refiner"
  | "verifier";

export type WorkflowPhase =
  | "INIT"
  | "REQUEST_CAPTURE"
  | "TOPIC_PROPOSAL"
  | "TOPIC_CONFIRMATION"
  | "V0_BRAINSTORMING"
  | "DESIGN_REVIEW_GATE"
  | "ISSUE_DECISION_GATE"
  | "CONVERSATIONAL_REVISION"
  | "DISCOVERY"
  | "INITIAL_DESIGN"
  | "REVIEW"
  | "TRIAGE"
  | "USER_DECISION"
  | "REFINE"
  | "VERIFY"
  | "FINAL_APPROVAL"
  | "COMPLETE"
  | "ABORTED"
  | "INTERRUPTED";

export type IssueCategory =
  | "requirement-gap"
  | "architecture"
  | "data-flow"
  | "error-handling"
  | "security"
  | "ux"
  | "testing"
  | "maintainability"
  | "scope-risk"
  | "future-extension";

export type IssueRecommendation =
  | "must-fix-now"
  | "should-fix-now"
  | "defer"
  | "optional"
  | "reject";

export type Evidence =
  | { type: "design-section"; section: string; quote: string }
  | { type: "artifact"; path: string; quote?: string }
  | { type: "repo-file"; path: string; lineStart?: number; lineEnd?: number; quote?: string };

export type DesignIssue = {
  id: string;
  sourceReviewer?: string;
  sourceIssueIds?: string[];
  title: string;
  description: string;
  category: IssueCategory;
  severity: IssueSeverity;
  confidence: IssueConfidence;
  evidence: Evidence[];
  riskIfIgnored: string;
  suggestedChange: string;
  estimatedCost: EstimatedCost;
  recommendation: IssueRecommendation;
  tradeoffs: {
    pros: string[];
    cons: string[];
  };
  dependsOn?: string[];
  conflictsWith?: string[];
  supersedes?: string[];
  duplicateOf?: string;
};

export type UserDecision = {
  issueId: string;
  decision: DecisionState;
  reason?: string;
};

export type VerificationResult = {
  issueId: string;
  status: VerificationStatus;
  evidence: string;
  requiredFollowup?: string;
};

export type DesignerOutput = {
  discoveryMarkdown: string;
  designMarkdown: string;
};

export type ReviewerOutput = {
  reviewer: string;
  issues: DesignIssue[];
  summary?: string;
};

export type TriageOutput = {
  issues: DesignIssue[];
  summary?: string;
};

export type RefinerChange = {
  issueId: string;
  summary: string;
  designSections?: string[];
};

export type RefinerOutput = {
  revisedDesign: string;
  changeLog: RefinerChange[];
  noOpJustifications?: Array<{ issueId: string; reason: string }>;
};

export type ClarifyOptions = {
  request: string;
  proposedTopic?: string;
  confirmedTopic?: string;
  resume: boolean;
  verbose: boolean;
  dryRun: boolean;
};

export type StatusOptions = {
  topic: string;
};

export type DiffOptions = {
  topic: string;
  run1?: string;
  run2?: string;
};

export type CleanOptions = {
  topic: string;
  dryRun: boolean;
  keep?: number;
};

export type TopicInfo = {
  displayName: string;
  slug: string;
  specDir: string;
  designPath: string;
  clarificationDir: string;
};

export type RunMetadata = {
  runId: string;
  topic: TopicInfo;
  request?: string;
  requestSummary?: string;
  proposedTopic?: string;
  confirmedTopic?: string;
  resumeStatus: ResumeStatus;
  currentPhase: WorkflowPhase;
  latestVersion: number;
  activeRound: number;
  pendingDecisionIds: string[];
  resumeHint: string;
  methodologyVersions: LifecycleMethodologyVersions;
  createdAt: string;
  updatedAt: string;
  cwd: string;
};

export type AgentSource = "bundled" | "user" | "project";

export type AgentDefinition = {
  name: string;
  role: AgentRole;
  description: string;
  path: string;
  source: AgentSource;
  tools: string[];
  model?: string;
  prompt: string;
};

export type AgentRunStatus = "success" | "failed" | "cancelled" | "timeout" | "invalid-output";

export type AgentUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  contextTokens?: number;
};

export type AgentRunResult<T = unknown> = {
  agentName: string;
  role: AgentRole;
  status: AgentRunStatus;
  attempt: number;
  requestedModel?: string;
  actualModel?: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stdout?: string;
  stderr?: string;
  rawOutput?: string;
  parsedOutput?: T;
  usage?: AgentUsage;
  error?: WorkflowError;
};

export type WorkflowErrorType =
  | "validation"
  | "config"
  | "path-safety"
  | "subagent"
  | "model-unavailable"
  | "timeout"
  | "cancelled"
  | "artifact-write"
  | "rate-limit"
  | "unknown";

export type WorkflowError = {
  type: WorkflowErrorType;
  message: string;
  phase?: WorkflowPhase;
  recoverable: boolean;
  path?: string;
  details?: unknown;
  occurredAt: string;
};

export type ReviewerState = {
  name: string;
  status: "pending" | "running" | "complete" | "failed";
  issueCount?: number;
  error?: WorkflowError;
};

export type ExecutionSummary = {
  status: "running" | "complete" | "failed" | "interrupted";
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCostUsd?: number;
  agentRuns: number;
  failedAgentRuns: number;
};

export type WorkflowState = {
  version: 1;
  metadata: RunMetadata;
  phase: WorkflowPhase;
  options: ClarifyOptions;
  round: number;
  refinementAttempts: number;
  completedArtifacts: string[];
  pendingDecisions: string[];
  designVersions?: DesignVersionMetadata[];
  designGateDecisions?: DesignGateDecision[];
  crossReviewProgress?: CrossReviewProgress;
  acceptedIssueIds: string[];
  rejectedIssueIds: string[];
  deferredIssueIds: string[];
  verification: {
    verified: boolean;
    results: VerificationResult[];
    unresolvedP0P1: string[];
    unreviewed?: boolean;
    unverifiedReason?: string;
  };
  reviewers: ReviewerState[];
  errors: WorkflowError[];
  execution: ExecutionSummary;
};

export type RetryConfig = {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  retryableErrors: WorkflowErrorType[];
};

export type ReviewerConfig = {
  enabled: string[];
  disabled: string[];
  custom: Array<{
    name: string;
    description: string;
    agentPath: string;
    model?: string;
    tools?: string[];
    priority?: number;
  }>;
  concurrency: number;
};

export type AgentConfig = {
  model?: string;
  tools?: string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export type BrainstormingProConfig = {
  version: 1;
  defaults: {
    mode: AutomationMode;
    maxRounds: number;
    threshold: IssueSeverity;
  };
  reviewers: ReviewerConfig;
  agents: Record<string, AgentConfig>;
  models: {
    default?: string;
    fallback: string[];
  };
  retry: RetryConfig;
  security: {
    allowProjectAgents: boolean;
    allowProjectToolExpansion: boolean;
    debugArtifacts: "enabled" | "redacted" | "disabled";
  };
  artifacts: {
    retention: {
      maxRuns: number;
      maxAgeDays: number;
    };
  };
  ui: {
    verbose: boolean;
    progress: boolean;
  };
};
