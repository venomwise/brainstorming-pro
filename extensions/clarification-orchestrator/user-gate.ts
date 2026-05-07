import type { DesignGateAction, DesignGateDecision, DesignIssue, UserDecision, WorkflowState, AutomationMode, IssueSeverity, DecisionState, TopicCandidate } from "./types.ts";
import type { RunPaths } from "./artifact-store.ts";
import { loadState, saveState, writeDesignGateDecision, writeJsonArtifact, writeMarkdownArtifact } from "./artifact-store.ts";
import { buildTopicChoices, renderTopicChoices } from "./topic-proposal.ts";
import { CLARIFICATION_TOPIC_FORMAT_MESSAGE, validateClarificationTopicSlug } from "./topic-validation.ts";

export type DecisionGateContext = {
  hasUI: boolean;
  ask?: (prompt: string) => Promise<string>;
};

export type DecisionPlan = {
  decisions: UserDecision[];
  requiresUserInput: DesignIssue[];
  deferredIssues: DesignIssue[];
};

export type TopicGateContext = {
  hasUI: boolean;
  input?: (title: string, placeholder?: string) => Promise<string | undefined>;
  notify?: (message: string, type?: "info" | "warning" | "error") => void;
};

export async function presentDesignReviewGate(params: {
  paths: RunPaths;
  version: number;
  designPath: string;
  changeSummary?: string;
  openQuestions?: string[];
  pendingBlockers?: string[];
  ctx: DecisionGateContext;
}): Promise<DesignGateDecision> {
  if (!params.ctx.hasUI || !params.ctx.ask) throw new Error("Design review gate requires interactive UI.");
  const prompt = [
    "Design review gate",
    `Version: v${params.version}`,
    `Design path: ${params.designPath}`,
    `Latest change: ${params.changeSummary ?? "Initial design"}`,
    `Open questions: ${params.openQuestions?.length ? params.openQuestions.join("; ") : "none"}`,
    `Pending blockers: ${params.pendingBlockers?.length ? params.pendingBlockers.join("; ") : "none"}`,
    "Choose one action: approve / review / revise / save",
  ].join("\n");
  const answer = await params.ctx.ask(prompt);
  const action = parseDesignGateAction(answer);
  const currentState = await loadState(params.paths);
  if (action === "approve") assertNoBlockingDiscussedIssues(currentState);
  const decision: DesignGateDecision = {
    id: `design-gate-v${params.version}-${Date.now()}`,
    version: params.version,
    action,
    reason: answer.trim(),
    createdAt: new Date().toISOString(),
  };
  await writeDesignGateDecision(params.paths, params.version, decision);
  const state = await loadState(params.paths);
  state.designGateDecisions ??= [];
  state.designGateDecisions.push(decision);
  state.metadata.resumeStatus = action === "save" ? "awaiting-design-gate-decision" : state.metadata.resumeStatus;
  await saveState(params.paths, state);
  return decision;
}

export function parseDesignGateAction(input: string): DesignGateAction {
  const normalized = input.trim().toLowerCase();
  if (normalized === "approve" || normalized === "a") return "approve";
  if (normalized === "review" || normalized === "r") return "review";
  if (normalized === "revise" || normalized === "v") return "revise";
  if (normalized === "save" || normalized === "s") return "save";
  throw new Error(`Invalid design gate action '${input}'. Choose approve, review, revise, or save.`);
}

export async function confirmTopicCandidate(params: {
  request: string;
  candidates: TopicCandidate[];
  ctx: TopicGateContext;
}): Promise<string> {
  if (!params.ctx.hasUI || !params.ctx.input) {
    throw new Error("Topic confirmation requires interactive UI. Use --dry-run to validate a request without creating artifacts.");
  }

  const choices = buildTopicChoices(params.candidates);
  const prompt = [
    "Choose a topic for this clarification run. Candidates and manual entries must be English kebab-case (for example 'task-dispatch-status').",
    "",
    `Request: ${params.request}`,
    "",
    renderTopicChoices(params.candidates),
    "",
    "Enter a candidate number, an existing/manual English kebab-case topic slug, or 'manual' to type a topic.",
  ].join("\n");
  params.ctx.notify?.(prompt, "info");
  const answer = (await params.ctx.input("Confirm clarification topic (English kebab-case)", "1, manual, or task-dispatch-status"))?.trim();
  if (!answer) throw new Error("Topic confirmation cancelled.");

  if (/^\d+$/.test(answer)) {
    const choice = choices[Number(answer) - 1];
    if (!choice) throw new Error(`Invalid topic choice '${answer}'.`);
    if (choice.action === "manual" || choice.action === "edit") return validateConfirmedTopic(await requestManualTopic(params.ctx, choice.topic));
    if (choice.topic) return validateConfirmedTopic(choice.topic);
  }

  if (answer.toLowerCase() === "manual") return validateConfirmedTopic(await requestManualTopic(params.ctx));
  return validateConfirmedTopic(answer);
}

async function requestManualTopic(ctx: TopicGateContext, prefill?: string): Promise<string> {
  let placeholder = prefill ?? "task-dispatch-status";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const manual = (await ctx.input?.("Enter clarification topic (English kebab-case)", placeholder))?.trim();
    if (!manual) throw new Error("Manual topic entry cancelled.");
    try {
      validateClarificationTopicSlug(manual);
      return manual;
    } catch (error) {
      if (attempt >= 3) throw error;
      ctx.notify?.(CLARIFICATION_TOPIC_FORMAT_MESSAGE, "error");
      placeholder = "task-dispatch-status";
    }
  }
  throw new Error("Manual topic entry cancelled.");
}

function validateConfirmedTopic(topic: string): string {
  validateClarificationTopicSlug(topic);
  return topic;
}

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
  return decisions.filter((decision) => decision.decision === "needs-discussion" || decision.decision === "discuss");
}

export function hasBlockingDiscussedIssues(state: WorkflowState): boolean {
  return state.pendingDecisions.length > 0 || (state.metadata.pendingDecisionIds?.length ?? 0) > 0;
}

export function assertNoBlockingDiscussedIssues(state: WorkflowState): void {
  if (hasBlockingDiscussedIssues(state)) throw new Error(`Cannot continue while issues need discussion: ${(state.metadata.pendingDecisionIds.length ? state.metadata.pendingDecisionIds : state.pendingDecisions).join(", ")}`);
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
  void mode;
  void threshold;
  return {
    requiresUserInput: issues,
    deferredIssues: [],
    decisions: [],
  };
}

export async function persistDecisionArtifacts(paths: RunPaths, decisions: UserDecision[], issues: DesignIssue[]): Promise<void> {
  const state = await loadState(paths);
  const jsonPath = await writeJsonArtifact(paths, `decisions-r${state.round}.json`, { decisions });
  const markdownPath = await writeMarkdownArtifact(paths, `decisions-r${state.round}.md`, renderDecisionMarkdown(decisions, issues));
  state.pendingDecisions = resolveNeedsDiscussion(decisions).map((decision) => decision.issueId);
  state.metadata.pendingDecisionIds = state.pendingDecisions;
  state.metadata.resumeStatus = state.pendingDecisions.length ? "awaiting-issue-decisions" : state.metadata.resumeStatus;
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
