import { appendWorkflowEvent } from "../../events.ts";
import { recordReviewDecision } from "../../gates.ts";
import type { WorkflowLayout } from "../../artifact-store.ts";
import type { WorkflowState } from "../../types.ts";
import type { ReviewerCoordinatorOptions } from "../design-review/reviewer-coordinator.ts";
import { runDesignReviewPanel } from "../design-review/panel.ts";
import type { DesignReviewPanelResult } from "../design-review/types.ts";
import { buildDesignRevisionPostReviewCompletedEvent, buildDesignRevisionPostReviewScheduledEvent } from "./events.ts";
import { readDesignRevisionRecord, writeDesignRevisionRecord } from "./ledger.ts";
import type { DesignRevisionAuthorization, DesignRevisionRecord } from "./types.ts";

export type PostRevisionReviewResult = {
  reviewDecisionId: string;
  panelResult: DesignReviewPanelResult;
  record: DesignRevisionRecord;
};

export async function schedulePostRevisionDesignReview(input: {
  layout: WorkflowLayout;
  state: WorkflowState;
  authorization: DesignRevisionAuthorization;
  targetDesignRef: NonNullable<DesignRevisionRecord["targetDesignRef"]>;
  options: ReviewerCoordinatorOptions;
}): Promise<PostRevisionReviewResult> {
  const decision = await recordReviewDecision(input.layout, {
    target: "design",
    mode: input.authorization.postRevisionReview.mode,
    artifacts: [input.targetDesignRef],
    selectedBy: "user",
    selectedAt: new Date().toISOString(),
    selectedReviewerRoles: input.authorization.postRevisionReview.selectedReviewerRoles,
    selectionReason: `post-revision review for ${input.authorization.revisionId}`,
  });
  const reviewState: WorkflowState = {
    ...input.state,
    phase: "design-review",
    artifacts: { ...input.state.artifacts, design: input.targetDesignRef },
    reviewDecisions: { ...input.state.reviewDecisions, design: decision },
    pendingDecision: undefined,
  };
  const panelResult = await runDesignReviewPanel(reviewState, input.options);
  await appendWorkflowEvent(input.layout, buildDesignRevisionPostReviewScheduledEvent({ revisionId: input.authorization.revisionId, targetDesignRef: input.targetDesignRef, postRevisionReviewRunId: panelResult.reviewRunId, scheduledAt: new Date().toISOString() }));
  await appendWorkflowEvent(input.layout, buildDesignRevisionPostReviewCompletedEvent({ revisionId: input.authorization.revisionId, targetDesignRef: input.targetDesignRef, postRevisionReviewRunId: panelResult.reviewRunId, status: panelResult.status, completedAt: new Date().toISOString() }));
  const previous = await readDesignRevisionRecord(input.layout, input.authorization.revisionId);
  const record = { ...previous, postRevisionReviewRunId: panelResult.reviewRunId };
  await writeDesignRevisionRecord(input.layout, record);
  return { reviewDecisionId: decision.id, panelResult, record };
}
