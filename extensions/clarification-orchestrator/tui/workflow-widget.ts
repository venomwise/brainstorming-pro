import type { WorkflowLiveSnapshot } from "../workflow/progress-types.ts";
import type { WorkflowDecisionBinding, WorkflowDecisionResult } from "../workflow/decision-facade.ts";
import type { RuntimeUserDecision } from "../workflow/runtime.ts";
import type { ReviewPanelViewModel } from "./review-panel-view-model.ts";
import { renderReviewPanelView } from "./review-panel/index.ts";
import { buildInteractiveGateModel, renderDecisionResult, renderInteractiveGateControl, type InteractiveGateModel } from "./decision-controls.ts";
import { formatWorkflowArtifactLabel, formatWorkflowDuration, formatWorkflowSafeCommandHint, formatWorkflowStatusGlyph } from "./formatters.ts";
import { truncateWorkflowToWidth, visibleWorkflowWidth } from "./render-helpers.ts";
import { renderWorkflowLiveSnapshotFallback } from "./workflow-result.ts";

export type WorkflowLiveWidgetMode = "compact" | "expanded";

export type WorkflowLiveWidgetOptions = {
  getSnapshot: () => WorkflowLiveSnapshot;
  initialMode?: WorkflowLiveWidgetMode;
  onClose?: () => void;
  now?: () => number;
  enableInteractiveDecisions?: boolean;
  getInteractiveGateModel?: (snapshot: WorkflowLiveSnapshot) => InteractiveGateModel;
  getReviewPanelViewModel?: (snapshot: WorkflowLiveSnapshot) => ReviewPanelViewModel | undefined;
  submitDecision?: (payload: { decision: RuntimeUserDecision; binding: WorkflowDecisionBinding }) => Promise<WorkflowDecisionResult>;
};

export type WorkflowWidgetInputResult = "handled" | "ignored" | "closed";

export class WorkflowLiveWidget {
  private readonly getSnapshot: () => WorkflowLiveSnapshot;
  private readonly onClose?: () => void;
  private readonly now: () => number;
  private mode: WorkflowLiveWidgetMode;
  private invalidated = true;
  private closed = false;
  private scrollOffset = 0;
  private readonly enableInteractiveDecisions: boolean;
  private readonly getInteractiveGateModel: (snapshot: WorkflowLiveSnapshot) => InteractiveGateModel;
  private readonly submitDecision?: (payload: { decision: RuntimeUserDecision; binding: WorkflowDecisionBinding }) => Promise<WorkflowDecisionResult>;
  private readonly getReviewPanelViewModel?: (snapshot: WorkflowLiveSnapshot) => ReviewPanelViewModel | undefined;
  private interactiveFocusIndex = 0;
  private lastDecisionResult?: WorkflowDecisionResult;

  constructor(options: WorkflowLiveWidgetOptions) {
    this.getSnapshot = options.getSnapshot;
    this.mode = options.initialMode ?? "compact";
    this.onClose = options.onClose;
    this.now = options.now ?? (() => Date.now());
    this.enableInteractiveDecisions = options.enableInteractiveDecisions ?? false;
    this.getInteractiveGateModel = options.getInteractiveGateModel ?? buildInteractiveGateModel;
    this.submitDecision = options.submitDecision;
    this.getReviewPanelViewModel = options.getReviewPanelViewModel;
  }

  render(width: number): string[] {
    if (this.closed) {
      return [];
    }
    const safeWidth = Math.max(20, width);
    try {
      const snapshot = this.getSnapshot();
      const lines = this.mode === "compact" ? renderCompactWorkflowSnapshot(snapshot, safeWidth, this.now()) : renderExpandedWorkflowSnapshot(snapshot, safeWidth, this.scrollOffset, this.now());
      if (this.mode === "expanded" && this.getReviewPanelViewModel) {
        try {
          const reviewPanel = this.getReviewPanelViewModel(snapshot);
          if (reviewPanel) section(lines, "Review panel", renderReviewPanelView(reviewPanel, safeWidth));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          section(lines, "Review panel", [`Review panel rendering unavailable: ${message}`, "Use /brainstorm-pro --status or /brainstorm-pro --resume."]);
        }
      }
      if (this.enableInteractiveDecisions) {
        const model = this.getInteractiveGateModel(snapshot);
        lines.push("", "Interactive decision controls:", ...renderInteractiveGateControl(model));
        if (this.lastDecisionResult) lines.push(...renderDecisionResult(this.lastDecisionResult));
      }
      this.invalidated = false;
      return lines.map((line) => fitLine(line, safeWidth));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return [`Workflow live progress fallback: ${message}`].map((line) => fitLine(line, safeWidth));
    }
  }

  handleInput(data: string | Buffer): WorkflowWidgetInputResult {
    const input = Buffer.isBuffer(data) ? data.toString("utf8") : data;
    if (input === "\u0003" || input === "q" || input === "Q" || input === "\u001b") {
      this.closed = true;
      this.onClose?.();
      return "closed";
    }
    if (this.enableInteractiveDecisions && (input === "\t" || input === "\u001b[Z")) {
      this.interactiveFocusIndex = Math.max(0, this.interactiveFocusIndex + (input === "\u001b[Z" ? -1 : 1));
      this.invalidate();
      return "handled";
    }
    if (input === "e" || input === "E" || input === " ") {
      this.mode = this.mode === "compact" ? "expanded" : "compact";
      this.invalidate();
      return "handled";
    }
    if (this.enableInteractiveDecisions && (input === "\r" || input === "\n")) {
      this.invalidate();
      return this.submitDecision ? "handled" : "ignored";
    }
    if (this.enableInteractiveDecisions && (input === "\u001b[C" || input === "\u001b[D" || input === "\u001b[A" || input === "\u001b[B")) {
      this.interactiveFocusIndex = Math.max(0, this.interactiveFocusIndex + (input === "\u001b[C" || input === "\u001b[B" ? 1 : -1));
      this.invalidate();
      return "handled";
    }
    if (input === "j" || input === "\u001b[B") {
      this.scrollOffset += 1;
      this.invalidate();
      return "handled";
    }
    if (input === "k" || input === "\u001b[A") {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.invalidate();
      return "handled";
    }
    return "ignored";
  }

  invalidate(): void {
    this.invalidated = true;
  }

  isInvalidated(): boolean {
    return this.invalidated;
  }
}

export function renderCompactWorkflowSnapshot(snapshot: WorkflowLiveSnapshot, width: number, now = Date.now()): string[] {
  const elapsed = elapsedLabel(snapshot.createdAt, now);
  const agentCounts = aggregateStatuses(snapshot.agents.map((agent) => agent.status));
  const reviewerCounts = aggregateStatuses(snapshot.reviewers.map((reviewer) => reviewer.status));
  const taskCounts = aggregateStatuses(snapshot.tasks.map((task) => task.status));
  const activity = snapshot.currentActivity?.label ?? snapshot.fallbackText;
  const primaryArtifact = snapshot.artifacts.at(-1);
  const gate = snapshot.gates[0];
  const lines = [
    `${formatWorkflowStatusGlyph(snapshot.stale ? "stale" : snapshot.phaseStatus)} ${snapshot.topic} • ${snapshot.phase} • ${elapsed}`,
    `Current: ${activity}`,
  ];
  const counts = [agentCounts ? `agents ${agentCounts}` : undefined, reviewerCounts ? `reviewers ${reviewerCounts}` : undefined, taskCounts ? `tasks ${taskCounts}` : undefined].filter((value): value is string => Boolean(value));
  if (counts.length) lines.push(counts.join(" • "));
  if (primaryArtifact) lines.push(`Artifact: ${formatWorkflowArtifactLabel(primaryArtifact)}`);
  if (gate) lines.push(`${gate.title}: ${formatWorkflowSafeCommandHint(gate.safeCommands)}`);
  if (snapshot.stale) lines.push(`Stale: ${snapshot.staleReason ?? "snapshot context is stale"}`);
  return lines.map((line) => fitLine(line, width));
}

export function renderExpandedWorkflowSnapshot(snapshot: WorkflowLiveSnapshot, width: number, scrollOffset = 0, now = Date.now()): string[] {
  const lines: string[] = [];
  lines.push(`${formatWorkflowStatusGlyph(snapshot.stale ? "stale" : snapshot.phaseStatus)} ${snapshot.topic} (${snapshot.runId})`);
  lines.push(`Phase: ${snapshot.phase} • ${snapshot.phaseStatus} • elapsed ${elapsedLabel(snapshot.createdAt, now)} • snapshot v${snapshot.version}`);
  if (snapshot.stale) lines.push(`Stale: ${snapshot.staleReason ?? "snapshot context is stale"}`);
  if (snapshot.currentActivity) section(lines, "Current activity", [`${snapshot.currentActivity.label} [${snapshot.currentActivity.status}]`]);
  if (snapshot.timeline.length) section(lines, "Timeline", snapshot.timeline.map((phase) => `${formatWorkflowStatusGlyph(String(phase.status))} ${phase.phase}${phase.activity ? ` — ${phase.activity}` : ""}`));
  if (snapshot.agents.length) section(lines, "Agents", snapshot.agents.map((agent) => `${agent.role ?? agent.agentRunId}: ${agent.status}${agent.outputBytes ? `, ${agent.outputBytes} bytes` : ""}${agent.summary ? ` — ${agent.summary}` : ""}`));
  if (snapshot.reviewers.length) section(lines, "Reviewers", snapshot.reviewers.map((reviewer) => `${reviewer.reviewerId} (${reviewer.target}/${reviewer.reviewRunId}): ${reviewer.status}${reviewer.findingCount === undefined ? "" : `, ${reviewer.findingCount} findings`}${reviewer.failureReason ? ` — ${reviewer.failureReason}` : ""}`));
  if (snapshot.tasks.length) section(lines, "Tasks", snapshot.tasks.map((task) => `${task.taskId}${task.title ? ` ${task.title}` : ""}: ${task.status}${task.activity ? ` — ${task.activity}` : ""}${task.evidencePath ? ` evidence ${task.evidencePath}` : ""}`));
  if (snapshot.artifacts.length) section(lines, "Artifacts", snapshot.artifacts.map(formatWorkflowArtifactLabel));
  if (snapshot.gates.length) section(lines, "Read-only gates", snapshot.gates.flatMap((gate) => renderGateCard(gate)));
  if (snapshot.diagnostics.length) section(lines, "Diagnostics", snapshot.diagnostics.map((diagnostic) => `${diagnostic.level.toUpperCase()}${diagnostic.code ? ` ${diagnostic.code}` : ""}: ${diagnostic.message}`));
  const safeCommands = [...new Set(snapshot.gates.flatMap((gate) => gate.safeCommands))];
  if (safeCommands.length) section(lines, "Safe next commands", safeCommands);

  const fitted = lines.map((line) => fitLine(line, width));
  return scrollOffset > 0 ? fitted.slice(scrollOffset) : fitted;
}

function renderGateCard(gate: WorkflowLiveSnapshot["gates"][number]): string[] {
  const lines = [`${formatWorkflowStatusGlyph(gate.stale ? "stale" : gate.status)} ${gate.title} (${gate.gate})`];
  if (gate.message) lines.push(`  ${gate.message}`);
  if (gate.artifacts.length) lines.push(`  Bindings: ${gate.artifacts.map((artifact) => `${artifact.kind} v${artifact.version}@${artifact.checksum.slice(0, 12)}`).join(", ")}`);
  if (gate.gate === "design-approval" || gate.gate === "plan-approval") lines.push("  Readiness is not approval; runtime validates approval binding.");
  if (gate.safeCommands.length) lines.push(`  ${formatWorkflowSafeCommandHint(gate.safeCommands)}`);
  return lines;
}

function section(lines: string[], title: string, body: string[]): void {
  if (!body.length) return;
  lines.push("");
  lines.push(`${title}:`);
  for (const line of body) lines.push(`- ${line}`);
}

function aggregateStatuses(statuses: readonly string[]): string | undefined {
  if (!statuses.length) return undefined;
  const completed = statuses.filter((status) => ["completed", "passed", "succeeded", "done"].includes(status)).length;
  const running = statuses.filter((status) => ["running", "started", "output", "retrying"].includes(status)).length;
  const failed = statuses.filter((status) => ["failed", "blocked", "invalid-output", "timed-out"].includes(status)).length;
  return `${completed} done/${running} running/${failed} failed`;
}

function elapsedLabel(createdAt: string, now: number): string {
  const started = Date.parse(createdAt);
  if (!Number.isFinite(started)) return "0ms";
  return formatWorkflowDuration(Math.max(0, now - started));
}

function fitLine(line: string, width: number): string {
  if (visibleWorkflowWidth(line) <= width) return line;
  return truncateWorkflowToWidth(line, Math.max(0, width));
}

export function renderWorkflowWidgetFallback(snapshot: WorkflowLiveSnapshot, width: number): string[] {
  return renderWorkflowLiveSnapshotFallback(snapshot, { width }).split("\n").map((line) => fitLine(line, width));
}
