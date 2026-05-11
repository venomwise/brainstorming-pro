import type { FullDesignReviewerRole, ReviewMode, VersionedArtifactRef } from "../../types.ts";
import type { DesignReviewReadinessReport, DesignReviewTriageReport } from "../design-review/types.ts";

export type DesignRevisionAllowedAction = "single-revision-and-rereview";

export type DesignRevisionStatus =
  | "authorized"
  | "started"
  | "needs-user-input"
  | "blocked"
  | "failed"
  | "committed"
  | "revision-exhausted"
  | "stale-source";

export type DesignRevisionTerminalStatus = Exclude<DesignRevisionStatus, "authorized" | "started">;

export type DesignRevisionUserQuestionDisposition = "requires-user-answer-before-revision" | "reviser-can-address" | "carry-forward";

export type DesignRevisionUserAnswer = {
  questionId: string;
  answer: string;
  answeredBy: "user";
  answeredAt: string;
};

export type DesignRevisionRoundPolicy = {
  maxTotalRevisionRounds: number;
  maxTotalPostRevisionReviewRounds: number;
  usedRevisionRounds: number;
  usedPostRevisionReviewRounds: number;
};

export type DesignRevisionPostReviewSettings = {
  mode: Exclude<ReviewMode, "skip">;
  selectedReviewerRoles?: FullDesignReviewerRole[];
};

export type DesignRevisionAuthorization = {
  revisionId: string;
  workflowRunId: string;
  topic: string;
  allowedAction: DesignRevisionAllowedAction;
  sourceDesignRef: VersionedArtifactRef;
  sourceReviewRunId: string;
  sourceReviewRunChecksum?: string;
  sourceTriageRef: { path: string; checksum: string };
  sourceReadinessRef: { path: string; checksum: string };
  sourceCoverageRef?: { path: string; checksum: string };
  postRevisionReview: DesignRevisionPostReviewSettings;
  roundPolicy: DesignRevisionRoundPolicy;
  userInstructions?: string;
  userAnswers: DesignRevisionUserAnswer[];
  authorizedBy: "user";
  authorizedAt: string;
  consumedAt?: string;
};

export type DesignRevisionRequest = {
  revisionId: string;
  workflowRunId: string;
  topic: string;
  sourceDesignRef: VersionedArtifactRef;
  sourceReviewRunId: string;
  sourceTriageRef: { path: string; checksum: string };
  sourceReadinessRef: { path: string; checksum: string };
  mustFixClusterIds: string[];
  shouldFixClusterIds: string[];
  conflictIds: string[];
  unresolvedQuestionIds: string[];
  carryForwardQuestionIds: string[];
  userAnswers: DesignRevisionUserAnswer[];
  userInstructions?: string;
  roundPolicy: DesignRevisionRoundPolicy;
  postRevisionReview: DesignRevisionPostReviewSettings;
  triage: Pick<DesignReviewTriageReport, "summary" | "clusters" | "conflicts" | "unresolvedQuestions">;
  readiness: DesignReviewReadinessReport;
  requestedAt: string;
};

export type DesignRevisionOutput = {
  revisedDesignMarkdown: string;
  changeSummary: string[];
  resolvedItemIds: string[];
  unresolvedItemIds: string[];
  assumptions: string[];
  riskNotes: string[];
};

export type DesignRevisionValidationResult = {
  status: "passed" | "failed";
  diagnostics: string[];
  validatedAt: string;
};

export type DesignRevisionRecord = {
  revisionId: string;
  workflowRunId: string;
  topic: string;
  status: DesignRevisionTerminalStatus;
  sourceDesignRef: VersionedArtifactRef;
  targetDesignRef?: VersionedArtifactRef;
  sourceReviewRunId: string;
  sourceTriageRef: { path: string; checksum: string };
  sourceReadinessRef: { path: string; checksum: string };
  sourceCoverageRef?: { path: string; checksum: string };
  postRevisionReviewRunId?: string;
  resolvedItemIds: string[];
  unresolvedItemIds: string[];
  blockingQuestionIds?: string[];
  changeSummary: string[];
  reason?: string;
  startedAt?: string;
  completedAt: string;
};
