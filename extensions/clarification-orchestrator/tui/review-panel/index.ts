import type { ReviewPanelViewModel } from "../review-panel-view-model.ts";
import { truncateWorkflowToWidth, visibleWorkflowWidth } from "../render-helpers.ts";
import { renderConflictQuestionView } from "./conflict-question-view.ts";
import { renderDesignReviewView } from "./design-review-view.ts";
import { renderDesignRevisionView } from "./design-revision-view.ts";
import { renderPlanReviewView } from "./plan-review-view.ts";
import { renderStaleEvidenceView } from "./stale-evidence-view.ts";
import { renderReadinessView, renderTriageView } from "./triage-view.ts";

export function renderReviewPanelView(viewModel: ReviewPanelViewModel, width: number): string[] {
  const lines: string[] = [];
  if (viewModel.designReview) {
    section(lines, "Design review", renderDesignReviewView(viewModel.designReview, width));
    section(lines, "Triage", renderTriageView(viewModel.designReview));
    section(lines, "Conflicts and questions", renderConflictQuestionView(viewModel.designReview.conflicts, viewModel.designReview.unresolvedQuestions));
    section(lines, "Readiness", renderReadinessView(viewModel.designReview.readiness));
  }
  if (viewModel.designRevision) section(lines, "Design revision", renderDesignRevisionView(viewModel.designRevision));
  if (viewModel.planReview) section(lines, "Plan review", renderPlanReviewView(viewModel.planReview));
  if (viewModel.staleEvidence.length) section(lines, "Stale evidence", renderStaleEvidenceView(viewModel.staleEvidence));
  if (viewModel.diagnostics.length) section(lines, "Review panel diagnostics", viewModel.diagnostics.map((diagnostic) => `${diagnostic.level.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`));
  if (!lines.length) lines.push("Review panel detail unavailable. Use /brainstorm-pro --status or /brainstorm-pro --resume.");
  return lines.map((line) => fitLine(line, width));
}

function section(lines: string[], title: string, body: string[]): void {
  if (!body.length) return;
  lines.push(`${title}:`);
  for (const line of body) lines.push(`- ${line}`);
}

function fitLine(line: string, width: number): string {
  if (visibleWorkflowWidth(line) <= width) return line;
  return truncateWorkflowToWidth(line, Math.max(0, width));
}
