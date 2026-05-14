import type { ReviewPanelViewModel } from "./review-panel-view-model.ts";
import { renderReviewPanelView } from "./review-panel/index.ts";
import { truncateWorkflowToWidth, visibleWorkflowWidth } from "./render-helpers.ts";

export type ReviewPanelFallbackOptions = {
  width?: number;
  includeSafeHints?: boolean;
};

export function renderReviewPanelFallback(viewModel: ReviewPanelViewModel, options: ReviewPanelFallbackOptions = {}): string {
  const width = Math.max(20, options.width ?? 80);
  const lines = ["Review summary:", ...renderReviewPanelView(viewModel, width)];
  if (options.includeSafeHints ?? true) lines.push("Safe next actions: /brainstorm-pro --resume or /brainstorm-pro --status");
  return lines.map((line) => fitLine(line, width)).join("\n");
}

function fitLine(line: string, width: number): string {
  if (visibleWorkflowWidth(line) <= width) return line;
  return truncateWorkflowToWidth(line, width);
}
