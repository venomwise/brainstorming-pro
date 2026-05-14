import type { DesignReviewPanelViewModel } from "../review-panel-view-model.ts";
import { artifactLabel } from "../review-panel-view-model.ts";

const knownDesignReviewers = new Set(["product-reviewer", "architecture-reviewer", "risk-security-reviewer", "testing-reviewer", "scope-simplicity-reviewer"]);

export function renderDesignReviewView(view: DesignReviewPanelViewModel, width: number): string[] {
  const lines: string[] = [];
  lines.push(`Design review ${view.reviewRunId ?? "run unavailable"}: ${view.status} (${view.mode})`);
  lines.push(`Design artifact: ${artifactLabel(view.designRef)}`);
  if (view.partial || view.incomplete || view.status === "partial" || view.status === "incomplete") {
    lines.push("Incomplete coverage is not a passed review.");
    lines.push("This is not design approval.");
    lines.push("Use /brainstorm-pro --resume or runtime-gated TUI controls for safe recovery actions.");
  }
  if (view.status === "passed") lines.push("Passed design review is not design approval; approval remains a separate runtime gate.");
  const coverage = width < 72 ? renderNarrowCoverage(view) : renderWideCoverage(view);
  if (coverage.length) lines.push("Reviewer coverage:", ...coverage.map((line) => `  ${line}`));
  for (const reviewer of view.coverage) {
    if (!knownDesignReviewers.has(reviewer.reviewerId)) lines.push(`Diagnostic: unknown reviewer ${reviewer.reviewerId}`);
  }
  if (!view.triage) lines.push("Triage unavailable; raw findings were not classified by the renderer.");
  if (!view.readiness) lines.push("Readiness unavailable; approval eligibility is not implied.");
  return lines;
}

function renderWideCoverage(view: DesignReviewPanelViewModel): string[] {
  return view.coverage.map((reviewer) => `${reviewer.selected === false ? "unselected" : "selected"} | ${reviewer.reviewerId} | ${reviewer.status}${findingText(reviewer.findingCounts?.total)}${reviewer.outputPath ? ` | ${reviewer.outputPath}` : ""}`);
}

function renderNarrowCoverage(view: DesignReviewPanelViewModel): string[] {
  return view.coverage.map((reviewer) => `${reviewer.reviewerId}: ${reviewer.selected === false ? "unselected" : "selected"}, ${reviewer.status}${findingText(reviewer.findingCounts?.total)}`);
}

function findingText(count: number | undefined): string {
  return count === undefined ? "" : `, ${count} findings`;
}
