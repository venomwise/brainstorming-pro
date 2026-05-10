export type WorkflowPhase =
  | "designing"
  | "awaiting-design-review-decision"
  | "design-review"
  | "awaiting-design-approval"
  | "planning"
  | "awaiting-plan-review-decision"
  | "plan-review"
  | "awaiting-plan-approval"
  | "executing"
  | "execution-review"
  | "done"
  | "blocked"
  | "failed";

export type ArtifactKind = "design" | "requirements" | "tasks";

export type VersionedArtifactRef = {
  kind: ArtifactKind;
  version: number;
  path: string;
  checksum: string;
  createdAt: string;
};

export type ReviewMode = "skip" | "minimal" | "full";

export type ReviewTarget = "design" | "plan" | "execution";

export type FullDesignReviewerRole =
  | "product-reviewer"
  | "architecture-reviewer"
  | "risk-security-reviewer"
  | "testing-reviewer"
  | "scope-simplicity-reviewer";

type BaseReviewDecisionRef = {
  id: string;
  target: ReviewTarget;
  mode: ReviewMode;
  artifacts: VersionedArtifactRef[];
  selectedBy: string;
  selectedAt: string;
  path: string;
};

export type FullDesignReviewDecisionRef = BaseReviewDecisionRef & {
  target: "design";
  mode: "full";
  selectedReviewerRoles?: FullDesignReviewerRole[];
  selectionReason?: string;
};

export type NonFullReviewDecisionRef = BaseReviewDecisionRef & {
  mode: "skip" | "minimal";
  selectedReviewerRoles?: never;
  selectionReason?: never;
};

export type NonDesignReviewDecisionRef = BaseReviewDecisionRef & {
  target: "plan" | "execution";
  selectedReviewerRoles?: never;
  selectionReason?: never;
};

export type ReviewDecisionRef = FullDesignReviewDecisionRef | NonFullReviewDecisionRef | NonDesignReviewDecisionRef;

export type ApprovalRef = {
  gate: "design" | "plan";
  artifacts: VersionedArtifactRef[];
  approvedBy: string;
  approvedAt: string;
  path: string;
};

export type ReviewPhaseStatus = {
  target: ReviewTarget;
  mode: ReviewMode;
  status: "pending" | "passed" | "blocked" | "failed" | "partial" | "skipped" | "unavailable";
  artifacts: VersionedArtifactRef[];
  reason?: string;
  readinessStatus?: string;
  enhancedReadiness?: unknown;
  triageSummary?: string;
  triage?: unknown;
  coverage?: unknown;
  recoveryActions?: unknown[];
  completedAt?: string;
};

export type UserDecisionRequest =
  | { type: "review-decision"; target: "design" | "plan"; artifacts: VersionedArtifactRef[]; choices: Array<ReviewMode | "revise" | "exit"> }
  | { type: "approval"; gate: "design" | "plan"; artifacts: VersionedArtifactRef[]; choices: Array<"approve" | "revise" | "status" | "exit"> };

export type WorkflowErrorSnapshot = {
  message: string;
  phase: WorkflowPhase;
  recoverable: boolean;
  occurredAt: string;
  details?: unknown;
};

export type WorkflowState = {
  version: 1;
  runId: string;
  topic: string;
  request: string;
  supplementalRequests?: Array<{ request: string; receivedAt: string }>;
  contextDesignPath?: string;
  phase: WorkflowPhase;
  createdAt: string;
  updatedAt: string;
  artifacts: Partial<Record<ArtifactKind, VersionedArtifactRef>>;
  reviewDecisions: Partial<Record<"design" | "plan" | "execution", ReviewDecisionRef>>;
  reviewStatus: Partial<Record<"design" | "plan" | "execution", ReviewPhaseStatus>>;
  gates: Partial<Record<"design" | "plan", ApprovalRef>>;
  pendingDecision?: UserDecisionRequest;
  lastError?: WorkflowErrorSnapshot;
};
