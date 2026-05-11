import type { VersionedArtifactRef } from "../../types.ts";
import type { DesignRevisionAuthorization, DesignRevisionRecord } from "./types.ts";

export type DesignRevisionAuthorizedPayload = {
  revisionId: string;
  sourceDesignRef: VersionedArtifactRef;
  sourceReviewRunId: string;
  authorizedAt: string;
};

export type DesignRevisionStartedPayload = {
  revisionId: string;
  sourceDesignRef: VersionedArtifactRef;
  sourceReviewRunId: string;
  startedAt: string;
};

export type DesignRevisionNeedsUserInputPayload = {
  revisionId: string;
  blockingQuestionIds: string[];
  recordedAt: string;
};

export type DesignRevisionFailedPayload = {
  revisionId: string;
  status: "blocked" | "failed" | "revision-exhausted" | "stale-source";
  reason: string;
  recordedAt: string;
};

export type DesignRevisionCommittedPayload = {
  revisionId: string;
  sourceDesignRef: VersionedArtifactRef;
  targetDesignRef: VersionedArtifactRef;
  committedAt: string;
};

export type DesignRevisionStaleInvalidatedPayload = {
  revisionId: string;
  targetDesignRef: VersionedArtifactRef;
  staleReviewRunId: string;
  invalidatedAt: string;
};

export type DesignRevisionPostReviewScheduledPayload = {
  revisionId: string;
  targetDesignRef: VersionedArtifactRef;
  postRevisionReviewRunId: string;
  scheduledAt: string;
};

export type DesignRevisionPostReviewCompletedPayload = {
  revisionId: string;
  targetDesignRef: VersionedArtifactRef;
  postRevisionReviewRunId: string;
  status: string;
  completedAt: string;
};

export type DesignRevisionEventPayload =
  | { type: "design-revision-authorized"; details: DesignRevisionAuthorizedPayload }
  | { type: "design-revision-started"; details: DesignRevisionStartedPayload }
  | { type: "design-revision-needs-user-input"; details: DesignRevisionNeedsUserInputPayload }
  | { type: "design-revision-failed"; details: DesignRevisionFailedPayload }
  | { type: "design-revision-committed"; details: DesignRevisionCommittedPayload }
  | { type: "design-revision-stale-invalidated"; details: DesignRevisionStaleInvalidatedPayload }
  | { type: "design-revision-post-review-scheduled"; details: DesignRevisionPostReviewScheduledPayload }
  | { type: "design-revision-post-review-completed"; details: DesignRevisionPostReviewCompletedPayload };

export function buildDesignRevisionAuthorizedEvent(authorization: DesignRevisionAuthorization): DesignRevisionEventPayload {
  return {
    type: "design-revision-authorized",
    details: {
      revisionId: authorization.revisionId,
      sourceDesignRef: authorization.sourceDesignRef,
      sourceReviewRunId: authorization.sourceReviewRunId,
      authorizedAt: authorization.authorizedAt,
    },
  };
}

export function buildDesignRevisionStartedEvent(input: { authorization: DesignRevisionAuthorization; startedAt: string }): DesignRevisionEventPayload {
  return {
    type: "design-revision-started",
    details: {
      revisionId: input.authorization.revisionId,
      sourceDesignRef: input.authorization.sourceDesignRef,
      sourceReviewRunId: input.authorization.sourceReviewRunId,
      startedAt: input.startedAt,
    },
  };
}

export function buildDesignRevisionNeedsUserInputEvent(input: { revisionId: string; blockingQuestionIds: string[]; recordedAt: string }): DesignRevisionEventPayload {
  return { type: "design-revision-needs-user-input", details: input };
}

export function buildDesignRevisionFailedEvent(record: DesignRevisionRecord): DesignRevisionEventPayload {
  if (record.status === "committed" || record.status === "needs-user-input") throw new Error(`Cannot build failed revision event for status: ${record.status}`);
  return {
    type: "design-revision-failed",
    details: {
      revisionId: record.revisionId,
      status: record.status,
      reason: record.reason ?? record.status,
      recordedAt: record.completedAt,
    },
  };
}

export function buildDesignRevisionCommittedEvent(record: DesignRevisionRecord): DesignRevisionEventPayload {
  if (!record.targetDesignRef) throw new Error("Committed revision event requires target design ref.");
  return {
    type: "design-revision-committed",
    details: {
      revisionId: record.revisionId,
      sourceDesignRef: record.sourceDesignRef,
      targetDesignRef: record.targetDesignRef,
      committedAt: record.completedAt,
    },
  };
}

export function buildDesignRevisionStaleInvalidatedEvent(input: { revisionId: string; targetDesignRef: VersionedArtifactRef; staleReviewRunId: string; invalidatedAt: string }): DesignRevisionEventPayload {
  return { type: "design-revision-stale-invalidated", details: input };
}

export function buildDesignRevisionPostReviewScheduledEvent(input: { revisionId: string; targetDesignRef: VersionedArtifactRef; postRevisionReviewRunId: string; scheduledAt: string }): DesignRevisionEventPayload {
  return { type: "design-revision-post-review-scheduled", details: input };
}

export function buildDesignRevisionPostReviewCompletedEvent(input: { revisionId: string; targetDesignRef: VersionedArtifactRef; postRevisionReviewRunId: string; status: string; completedAt: string }): DesignRevisionEventPayload {
  return { type: "design-revision-post-review-completed", details: input };
}
