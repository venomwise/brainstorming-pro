import type { ReviewerState, WorkflowPhase, WorkflowState } from "./types.ts";

export type ProgressSink = {
  notify?: (message: string, level?: "info" | "warning" | "error") => void;
  log?: (message: string) => void;
};

export type ProgressReporter = {
  setPhaseProgress: (phase: WorkflowPhase, detail?: string) => void;
  setReviewerStatus: (name: string, status: ReviewerState["status"], issueCount?: number) => void;
  setActivity: (activity: string) => void;
  renderProgressSummary: (state: WorkflowState) => string;
  reviewers: Map<string, ReviewerState>;
  activity?: string;
};

export function createProgressReporter(sink: ProgressSink = {}): ProgressReporter {
  const reviewers = new Map<string, ReviewerState>();
  let activity: string | undefined;

  return {
    reviewers,
    get activity() {
      return activity;
    },
    setPhaseProgress(phase, detail) {
      const message = `Phase ${phase}${detail ? `: ${detail}` : ""}`;
      sink.notify?.(message, "info") ?? sink.log?.(message);
    },
    setReviewerStatus(name, status, issueCount) {
      reviewers.set(name, { name, status, issueCount });
      const message = `Reviewer ${name}: ${status}${issueCount !== undefined ? ` (${issueCount} issues)` : ""}`;
      sink.notify?.(message, status === "failed" ? "warning" : "info") ?? sink.log?.(message);
    },
    setActivity(next) {
      activity = next;
      sink.notify?.(next, "info") ?? sink.log?.(next);
    },
    renderProgressSummary,
  };
}

export function renderProgressSummary(state: WorkflowState): string {
  return [
    `Run: ${state.metadata.runId}`,
    `Phase: ${state.phase}`,
    `Round: ${state.round}`,
    `Artifacts: ${state.completedArtifacts.length}`,
    `Pending decisions: ${state.pendingDecisions.length}`,
    `Errors: ${state.errors.length}`,
    `Reviewers: ${state.reviewers.map((reviewer) => `${reviewer.name}=${reviewer.status}`).join(", ") || "none"}`,
    state.errors.length > 0 ? `Recovery: /clarify ${state.metadata.topic.displayName} --resume` : "Recovery: none needed",
  ].join("\n");
}

export const setPhaseProgress = (reporter: ProgressReporter, phase: WorkflowPhase, detail?: string) => reporter.setPhaseProgress(phase, detail);
export const setReviewerStatus = (reporter: ProgressReporter, name: string, status: ReviewerState["status"], issueCount?: number) => reporter.setReviewerStatus(name, status, issueCount);
export const setActivity = (reporter: ProgressReporter, activity: string) => reporter.setActivity(activity);
