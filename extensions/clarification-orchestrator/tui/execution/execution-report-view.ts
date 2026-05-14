import type { ExecutionReportView, ExecutionViewModel } from "../execution-view-model.ts";

export function renderExecutionReportView(report: ExecutionReportView | undefined, model: ExecutionViewModel): string[] {
  const lines: string[] = [];
  if (report) {
    lines.push(`Report: ${report.status}${report.mode ? ` • mode ${report.mode}` : ""}`);
    if (report.completedTaskCount !== undefined || report.remainingTaskCount !== undefined || report.skippedOptionalTaskCount !== undefined) {
      lines.push(`Tasks: ${report.completedTaskCount ?? "?"} completed, ${report.remainingTaskCount ?? "?"} remaining, ${report.skippedOptionalTaskCount ?? "?"} skipped optional`);
    }
    if (report.changedFilesCount !== undefined) lines.push(`Changed files: ${report.changedFilesCount}`);
    if (report.blockerCount !== undefined) lines.push(`Blockers: ${report.blockerCount}`);
    for (const command of report.validationCommands) lines.push(`Validation: ${command.status} ${command.command}${command.summary ? ` — ${command.summary}` : ""}`);
    if (report.summaryText) lines.push(`Summary: ${report.summaryText}`);
    if (report.jsonPath) lines.push(`JSON report: ${report.jsonPath}`);
    if (report.markdownPath) lines.push(`Markdown report: ${report.markdownPath}`);
  } else if (model.phase === "done" || model.status === "completed") {
    lines.push("Report unavailable: execution completed but report metadata is unavailable.");
  }
  if (model.phase === "done" || model.status === "completed") lines.push("Done: controlled execution is complete.");
  return lines;
}
