import type { ConflictViewModel, UnresolvedQuestionViewModel } from "../review-panel-view-model.ts";

export function renderConflictQuestionView(conflicts: ConflictViewModel[], questions: UnresolvedQuestionViewModel[]): string[] {
  const lines: string[] = [];
  if (conflicts.length) {
    lines.push("Conflicts:");
    for (const conflict of conflicts) lines.push(`  ${conflict.id} ${conflict.category}: ${conflict.description}${conflict.consequence ? ` Consequence: ${conflict.consequence}` : ""}`);
  }
  if (questions.length) {
    lines.push("Unresolved questions:");
    for (const question of questions) lines.push(`  ${question.id}${question.blocking ? " [blocking]" : ""}: ${question.prompt}${question.sourceContext ? ` Source: ${question.sourceContext}` : ""}`);
    lines.push("Questions can only be answered through runtime-gated /brainstorm-pro --resume decision paths.");
  }
  return lines;
}
