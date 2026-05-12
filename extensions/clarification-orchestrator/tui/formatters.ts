/**
 * Derived from nicobailon/pi-subagents src/shared/formatters.ts.
 * Upstream notice token: pi-subagents@0.24.0.
 * Licensed under the MIT License; see vendor/pi-subagents/LICENSE and NOTICE.md.
 * Adapted for Brainstorming Pro workflow runtime terminology and tests.
 */

/**
 * Minimal usage counters for Brainstorming Pro child/reviewer summaries.
 */
export type WorkflowUsage = {
  turns?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
};

export type WorkflowStepSummary = {
  name: string;
  durationMs?: number;
  status?: "completed" | "failed" | "skipped";
};

export type WorkflowStatusGlyph = "running" | "completed" | "blocked" | "failed" | "awaiting-user" | "done" | "stale" | "pending" | "info";

export function formatWorkflowTokens(count: number): string {
  if (!Number.isFinite(count)) return "0";
  const safeCount = Math.max(0, Math.trunc(count));
  if (safeCount < 1000) return String(safeCount);
  if (safeCount < 10000) return `${(safeCount / 1000).toFixed(1)}k`;
  return `${Math.round(safeCount / 1000)}k`;
}

export function formatWorkflowUsage(usage: WorkflowUsage, model?: string): string {
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input) parts.push(`in:${formatWorkflowTokens(usage.input)}`);
  if (usage.output) parts.push(`out:${formatWorkflowTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatWorkflowTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatWorkflowTokens(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (model) parts.push(model);
  return parts.join(" ");
}

export function formatWorkflowDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return "0ms";
  const safeMilliseconds = Math.max(0, Math.trunc(milliseconds));
  if (safeMilliseconds < 1000) return `${safeMilliseconds}ms`;
  if (safeMilliseconds < 60000) return `${(safeMilliseconds / 1000).toFixed(1)}s`;
  return `${Math.floor(safeMilliseconds / 60000)}m${Math.floor((safeMilliseconds % 60000) / 1000)}s`;
}

export function shortenWorkflowPath(filePath: string, home = process.env.HOME): string {
  if (home && filePath === home) return "~";
  if (home && filePath.startsWith(`${home}/`)) return `~${filePath.slice(home.length)}`;
  return filePath;
}

export function formatWorkflowStatusGlyph(status: WorkflowStatusGlyph | string): string {
  switch (status) {
    case "running":
      return "…";
    case "completed":
    case "done":
      return "✅";
    case "blocked":
      return "⏸";
    case "failed":
      return "❌";
    case "awaiting-user":
      return "⏳";
    case "stale":
      return "⚠";
    case "pending":
      return "○";
    default:
      return "•";
  }
}

export function formatWorkflowCount(completed: number, total: number, label: string): string {
  const safeCompleted = Math.max(0, Math.trunc(completed));
  const safeTotal = Math.max(safeCompleted, Math.trunc(total));
  return `${safeCompleted}/${safeTotal} ${label}`;
}

export function formatWorkflowChecksumPrefix(checksum: string, length = 12): string {
  const trimmed = checksum.trim();
  if (!trimmed) return "unknown";
  return trimmed.slice(0, Math.max(4, length));
}

export function formatWorkflowArtifactLabel(input: { kind: string; version: number; checksum?: string; path?: string }): string {
  const checksum = input.checksum ? `@${formatWorkflowChecksumPrefix(input.checksum)}` : "";
  const path = input.path ? ` ${shortenWorkflowPath(input.path)}` : "";
  return `${input.kind} v${input.version}${checksum}${path}`;
}

export function shortenWorkflowDisplayPath(filePath: string, maxWidth: number): string {
  const shortened = shortenWorkflowPath(filePath);
  if (shortened.length <= maxWidth) return shortened;
  if (maxWidth <= 1) return "…".slice(0, Math.max(0, maxWidth));
  const tail = shortened.slice(Math.max(0, shortened.length - maxWidth + 1));
  return `…${tail}`;
}

export function formatWorkflowSafeCommandHint(commands: readonly string[]): string {
  if (!commands.length) return "No follow-up command required.";
  return `Safe next command: ${commands[0]}`;
}

export function formatWorkflowStepSummary(steps: WorkflowStepSummary[]): string {
  if (!steps.length) return "No workflow steps recorded.";
  const totalDuration = steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0);
  const failed = steps.find((step) => step.status === "failed");
  const names = steps.map((step) => step.name).join(" → ");
  const duration = formatWorkflowDuration(totalDuration);
  if (failed) return `❌ Workflow failed at ${failed.name}: ${names} (${steps.length} steps, ${duration})`;
  return `✅ Workflow steps completed: ${names} (${steps.length} ${steps.length === 1 ? "step" : "steps"}, ${duration})`;
}
