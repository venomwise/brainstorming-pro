import type { DesignIssue, UserDecision, WorkflowState, AutomationMode, IssueSeverity, DecisionState } from "./types.ts";
import type { RunPaths } from "./artifact-store.ts";
import { loadState, saveState, writeJsonArtifact, writeMarkdownArtifact } from "./artifact-store.ts";

export type DecisionGateContext = {
  hasUI: boolean;
  ask?: (prompt: string) => Promise<string>;
};

export type DecisionPlan = {
  decisions: UserDecision[];
  requiresUserInput: DesignIssue[];
  deferredIssues: DesignIssue[];
};

const severityRank: Record<IssueSeverity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export async function presentDecisionGate(params: {
  paths: RunPaths;
  issues: DesignIssue[];
  mode: AutomationMode;
  threshold: IssueSeverity;
  ctx: DecisionGateContext;
}): Promise<UserDecision[]> {
  const plan = planDecisions(params.issues, params.mode, params.threshold);
  if (!params.ctx.hasUI && plan.requiresUserInput.length > 0) {
    await writePendingDecisions(params.paths, plan.requiresUserInput, plan.deferredIssues);
    const state = await loadState(params.paths);
    state.phase = "USER_DECISION";
    state.pendingDecisions = plan.requiresUserInput.map((issue) => issue.id);
    await saveState(params.paths, state);
    return plan.decisions;
  }

  const decisions = [...plan.decisions];
  for (const issue of plan.requiresUserInput) decisions.push(await collectDecision(issue, params.ctx));
  await persistDecisionArtifacts(params.paths, decisions, params.issues);
  return decisions;
}

export async function collectDecision(issue: DesignIssue, ctx: DecisionGateContext): Promise<UserDecision> {
  if (!ctx.ask) return { issueId: issue.id, decision: "needs-discussion", reason: "No interactive collector available." };
  const answer = (await ctx.ask(formatIssuePrompt(issue))).trim().toLowerCase();
  const decision = parseDecision(answer);
  return { issueId: issue.id, decision, reason: answer };
}

export function resolveNeedsDiscussion(decisions: UserDecision[]): UserDecision[] {
  return decisions.filter((decision) => decision.decision === "needs-discussion");
}

export function summarizeDeferredIssues(issues: DesignIssue[]): string {
  if (issues.length === 0) return "No deferred issues.";
  return issues.map((issue) => `- ${issue.id} (${issue.severity}): ${issue.title}`).join("\n");
}

export function applyManualMode(issues: DesignIssue[], threshold: IssueSeverity): DecisionPlan {
  const requiresUserInput = issues.filter((issue) => atOrAboveThreshold(issue.severity, threshold));
  const deferredIssues = issues.filter((issue) => !atOrAboveThreshold(issue.severity, threshold));
  return {
    requiresUserInput,
    deferredIssues,
    decisions: deferredIssues.map((issue) => ({ issueId: issue.id, decision: "defer", reason: "Below configured threshold." })),
  };
}

export function applyHybridMode(issues: DesignIssue[], threshold: IssueSeverity): DecisionPlan {
  const requiresUserInput = issues.filter((issue) => atOrAboveThreshold(issue.severity, threshold) || isAlwaysSurfaced(issue));
  const userIds = new Set(requiresUserInput.map((issue) => issue.id));
  const deferredIssues = issues.filter((issue) => !userIds.has(issue.id));
  return {
    requiresUserInput,
    deferredIssues,
    decisions: deferredIssues.map((issue) => ({ issueId: issue.id, decision: "defer", reason: "Hybrid mode deferred lower-priority issue." })),
  };
}

export function applyAutoMode(issues: DesignIssue[], threshold: IssueSeverity): DecisionPlan {
  const requiresUserInput = issues.filter(isAlwaysSurfaced);
  const userIds = new Set(requiresUserInput.map((issue) => issue.id));
  const decisions = issues
    .filter((issue) => !userIds.has(issue.id))
    .map((issue): UserDecision => ({
      issueId: issue.id,
      decision: atOrAboveThreshold(issue.severity, threshold) ? "accept" : "defer",
      reason: atOrAboveThreshold(issue.severity, threshold) ? "Auto mode accepted low-risk high-priority issue." : "Auto mode deferred lower-priority issue.",
    }));
  return { requiresUserInput, deferredIssues: issues.filter((issue) => decisions.some((d) => d.issueId === issue.id && d.decision === "defer")), decisions };
}

export function planDecisions(issues: DesignIssue[], mode: AutomationMode, threshold: IssueSeverity): DecisionPlan {
  if (mode === "manual") return applyManualMode(issues, threshold);
  if (mode === "auto") return applyAutoMode(issues, threshold);
  return applyHybridMode(issues, threshold);
}

export async function persistDecisionArtifacts(paths: RunPaths, decisions: UserDecision[], issues: DesignIssue[]): Promise<void> {
  const state = await loadState(paths);
  const jsonPath = await writeJsonArtifact(paths, `decisions-r${state.round}.json`, { decisions });
  const markdownPath = await writeMarkdownArtifact(paths, `decisions-r${state.round}.md`, renderDecisionMarkdown(decisions, issues));
  state.pendingDecisions = resolveNeedsDiscussion(decisions).map((decision) => decision.issueId);
  state.acceptedIssueIds = decisions.filter((decision) => decision.decision === "accept").map((decision) => decision.issueId);
  state.rejectedIssueIds = decisions.filter((decision) => decision.decision === "reject").map((decision) => decision.issueId);
  state.deferredIssueIds = decisions.filter((decision) => decision.decision === "defer").map((decision) => decision.issueId);
  for (const artifactPath of [jsonPath, markdownPath]) if (!state.completedArtifacts.includes(artifactPath)) state.completedArtifacts.push(artifactPath);
  await saveState(paths, state);
}

async function writePendingDecisions(paths: RunPaths, required: DesignIssue[], deferred: DesignIssue[]): Promise<void> {
  await writeMarkdownArtifact(paths, "pending-decisions.md", ["# Pending Decisions", "", "## Requires input", summarizeDeferredIssues(required), "", "## Deferred by mode", summarizeDeferredIssues(deferred), "", "Resume with `/clarify <topic> --resume`."].join("\n"));
}

function renderDecisionMarkdown(decisions: UserDecision[], issues: DesignIssue[]): string {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  return ["# Decisions", "", ...decisions.map((decision) => `- ${decision.issueId}: ${decision.decision} — ${byId.get(decision.issueId)?.title ?? ""}${decision.reason ? ` (${decision.reason})` : ""}`), ""].join("\n");
}

function formatIssuePrompt(issue: DesignIssue): string {
  return [`${issue.id}: ${issue.title}`, issue.description, "Choose: accept / reject / defer / discuss"].join("\n");
}

function parseDecision(answer: string): DecisionState {
  if (answer.startsWith("a")) return "accept";
  if (answer.startsWith("r")) return "reject";
  if (answer.startsWith("d") && !answer.startsWith("dis")) return "defer";
  return "needs-discussion";
}

function atOrAboveThreshold(severity: IssueSeverity, threshold: IssueSeverity): boolean {
  return severityRank[severity] <= severityRank[threshold];
}

function isAlwaysSurfaced(issue: DesignIssue): boolean {
  return issue.estimatedCost === "high" || issue.confidence === "low" || (issue.conflictsWith?.length ?? 0) > 0 || issue.category === "scope-risk" || issue.severity === "P0";
}
