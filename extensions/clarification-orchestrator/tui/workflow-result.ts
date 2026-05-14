import type { WorkflowLiveSnapshot } from "../workflow/progress-types.ts";
import type { ExecutionViewModel } from "./execution-view-model.ts";
import { renderExecutionFallback } from "./execution-fallback.ts";
import {
  formatWorkflowArtifactLabel,
  formatWorkflowSafeCommandHint,
  formatWorkflowStatusGlyph,
  shortenWorkflowDisplayPath,
} from "./formatters.ts";
import { truncateWorkflowToWidth } from "./render-helpers.ts";

export type WorkflowLiveSnapshotFallbackOptions = {
  plain?: boolean;
  width?: number;
  executionViewModel?: ExecutionViewModel;
};

export function renderWorkflowLiveSnapshotFallback(snapshot: WorkflowLiveSnapshot, options: WorkflowLiveSnapshotFallbackOptions = {}): string {
  const width = Math.max(20, options.width ?? 100);
  const lines: string[] = [];
  const push = (line: string): void => {
    lines.push(truncateWorkflowToWidth(line, width));
  };

  push(`# Workflow status: ${snapshot.topic}`);
  push(`${formatWorkflowStatusGlyph(snapshot.stale ? "stale" : snapshot.phaseStatus)} Phase: ${snapshot.phase} (${snapshot.phaseStatus})`);
  push(`Run: ${snapshot.runId} | Snapshot: v${snapshot.version} | Updated: ${snapshot.updatedAt}`);

  if (snapshot.stale) {
    push(`⚠ Stale snapshot: ${snapshot.staleReason ?? "live progress context is stale"}`);
  }

  if (snapshot.currentActivity) {
    push(`Current: ${snapshot.currentActivity.label} [${snapshot.currentActivity.status}]`);
  } else if (snapshot.fallbackText) {
    push(snapshot.fallbackText);
  }

  if (snapshot.artifacts.length) {
    push("");
    push("## Artifacts");
    for (const artifact of snapshot.artifacts) {
      push(`- ${formatWorkflowArtifactLabel(artifact)}`);
    }
  }

  if (snapshot.gates.length) {
    push("");
    push("## Gates / cards");
    for (const gate of snapshot.gates) {
      push(`- ${formatWorkflowStatusGlyph(gate.stale ? "stale" : gate.status)} ${gate.title} (${gate.gate})`);
      if (gate.message) push(`  ${gate.message}`);
      if (gate.artifacts.length) push(`  Bindings: ${gate.artifacts.map((artifact) => `${artifact.kind} v${artifact.version}@${artifact.checksum.slice(0, 12)}`).join(", ")}`);
      if (gate.safeCommands.length) push(`  ${formatWorkflowSafeCommandHint(gate.safeCommands)}`);
    }
  }

  if (snapshot.agents.length || snapshot.reviewers.length || snapshot.tasks.length) {
    push("");
    push("## Live progress");
    for (const agent of snapshot.agents) {
      push(`- Agent ${agent.role ?? agent.agentRunId}: ${agent.status}${agent.outputBytes ? ` (${agent.outputBytes} bytes)` : ""}`);
    }
    for (const reviewer of snapshot.reviewers) {
      push(`- Reviewer ${reviewer.reviewerId}: ${reviewer.status}${reviewer.findingCount === undefined ? "" : ` (${reviewer.findingCount} findings)`}`);
    }
    for (const task of snapshot.tasks) {
      push(`- Task ${task.taskId}${task.title ? ` ${task.title}` : ""}: ${task.status}${task.evidencePath ? ` evidence ${shortenWorkflowDisplayPath(task.evidencePath, 40)}` : ""}`);
    }
  }

  if (options.executionViewModel) {
    push("");
    push("## Execution");
    for (const line of renderExecutionFallback(options.executionViewModel, { width }).split("\n")) push(line);
  }

  if (snapshot.diagnostics.length) {
    push("");
    push("## Diagnostics");
    for (const diagnostic of snapshot.diagnostics) {
      push(`- ${diagnostic.level.toUpperCase()}${diagnostic.code ? ` ${diagnostic.code}` : ""}: ${diagnostic.message}`);
    }
  }

  const safeCommands = snapshot.gates.flatMap((gate) => gate.safeCommands);
  if (safeCommands.length) {
    push("");
    push("## Safe next commands");
    for (const command of [...new Set(safeCommands)]) {
      push(`- ${command}`);
    }
  }

  return lines.join("\n");
}
