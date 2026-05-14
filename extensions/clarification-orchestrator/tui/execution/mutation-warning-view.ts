import type { ExecutionMutationWarningView } from "../execution-view-model.ts";

export function renderMutationWarningView(warnings: readonly ExecutionMutationWarningView[]): string[] {
  return warnings.map((warning) => {
    const affected = [warning.affectedPath, warning.affectedTaskIds.length ? `tasks ${warning.affectedTaskIds.join(", ")}` : undefined].filter(Boolean).join("; ");
    const closed = warning.failClosed ? " Execution remains fail-closed." : "";
    return `${warning.severity.toUpperCase()}: ${warning.message}${affected ? ` (${affected})` : ""}.${closed}`;
  });
}
