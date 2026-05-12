import fs from "node:fs/promises";
import path from "node:path";
import type { WorkflowLayout } from "./artifact-store.ts";
import { assertWorkflowPath } from "./artifact-store.ts";
import type { FullDesignReviewerRole, VersionedArtifactRef, WorkflowPhase } from "./types.ts";
import type { DesignReviewCoverage } from "./adapters/design-review/types.ts";

export type WorkflowEvent = {
  type: string;
  timestamp: string;
  phase?: WorkflowPhase;
  details?: unknown;
};

export type DesignReviewReviewerSelectionRecordedPayload = {
  decisionId: string;
  designRef: VersionedArtifactRef;
  selectedReviewerRoles: FullDesignReviewerRole[];
  unselectedReviewerRoles: FullDesignReviewerRole[];
  recordedAt: string;
};

export type DesignReviewAttemptStartedPayload = {
  reviewRunId: string;
  attemptId: string;
  reviewerRoles: FullDesignReviewerRole[];
  startedAt: string;
};

export type DesignReviewAttemptCompletedPayload = {
  reviewRunId: string;
  attemptId: string;
  reviewerRoles: FullDesignReviewerRole[];
  succeededReviewerRoles: FullDesignReviewerRole[];
  failedReviewerRoles: FullDesignReviewerRole[];
  completedAt: string;
};

export type DesignReviewPartialAggregatedPayload = {
  reviewRunId: string;
  coverage: DesignReviewCoverage;
  readinessStatus: "incomplete-review" | "blocked" | "failed";
  aggregatedAt: string;
};

export type DesignReviewFailedReviewersRetriedPayload = {
  reviewRunId: string;
  attemptId: string;
  reviewerRoles: FullDesignReviewerRole[];
  retriedAt: string;
};

export type DesignReviewIncompleteAcceptedPayload = {
  decisionId: string;
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  acceptedCoverage: DesignReviewCoverage;
  acceptedAt: string;
};

export type PlanReviewEventPayload =
  | { type: "plan-review-started"; details: { reviewRunId: string; artifactRefs: VersionedArtifactRef[]; ledgerPath: string } }
  | { type: "plan-review-reviewer-completed"; details: { reviewRunId: string; reviewerRole: string; status: string } }
  | { type: "plan-review-readiness"; details: { reviewRunId: string; readinessStatus: string; ledgerPath: string } }
  | { type: "plan-revision-started"; details: { revisionId: string; sourceReviewRunId: string } }
  | { type: "plan-revision-committed"; details: { revisionId: string; artifactRefs: VersionedArtifactRef[]; ledgerPath: string } }
  | { type: "plan-review-rereview-started"; details: { reviewRunId: string; revisionId: string; artifactRefs: VersionedArtifactRef[] } }
  | { type: "plan-review-blocked"; details: { reviewRunId: string; readinessStatus: string; diagnostics?: unknown } }
  | { type: "plan-review-failed"; details: { reviewRunId: string; diagnostics?: unknown } };

export type DesignReviewExecutionControlEventPayload =
  | { type: "design-review-reviewer-selection-recorded"; details: DesignReviewReviewerSelectionRecordedPayload }
  | { type: "design-review-attempt-started"; details: DesignReviewAttemptStartedPayload }
  | { type: "design-review-attempt-completed"; details: DesignReviewAttemptCompletedPayload }
  | { type: "design-review-partial-aggregated"; details: DesignReviewPartialAggregatedPayload }
  | { type: "design-review-failed-reviewers-retried"; details: DesignReviewFailedReviewersRetriedPayload }
  | { type: "design-review-incomplete-accepted"; details: DesignReviewIncompleteAcceptedPayload };

export async function appendWorkflowEvent(layout: WorkflowLayout, event: Omit<WorkflowEvent, "timestamp"> & { timestamp?: string }): Promise<WorkflowEvent> {
  assertWorkflowPath(layout, layout.eventsPath);
  await fs.mkdir(path.dirname(layout.eventsPath), { recursive: true });
  const persisted = { ...event, timestamp: event.timestamp ?? new Date().toISOString() };
  await fs.appendFile(layout.eventsPath, `${JSON.stringify(persisted)}\n`, "utf8");
  return persisted;
}

export async function readWorkflowEvents(layout: WorkflowLayout): Promise<WorkflowEvent[]> {
  assertWorkflowPath(layout, layout.eventsPath);
  try {
    const text = await fs.readFile(layout.eventsPath, "utf8");
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as WorkflowEvent);
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}
