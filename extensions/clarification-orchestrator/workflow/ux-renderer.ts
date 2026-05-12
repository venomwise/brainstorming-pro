import type { VersionedArtifactRef, WorkflowErrorSnapshot } from "./types.ts";

const fullDesignReviewerDescriptions: Record<string, string> = {
  "product-reviewer": "Product fit, user value, requirements clarity, non-goals, and scope alignment.",
  "architecture-reviewer": "Architecture coherence, interfaces, maintainability, data flow, and technical trade-offs.",
  "risk-security-reviewer": "Security, privacy, abuse cases, operational risk, and fail-closed boundaries.",
  "testing-reviewer": "Testability, validation strategy, acceptance coverage, and regression risks.",
  "scope-simplicity-reviewer": "Scope control, simplicity, unnecessary complexity, and MVP boundaries.",
};

const fixedPlanReviewers = ["requirements-coverage-reviewer", "task-coverage-reviewer", "dependency-order-reviewer"];

export function renderWorkflowUxResult(result: unknown): string {
  if (isSelectionResult(result)) return renderSelection(result.selectionRequired);
  if (isObject(result) && typeof result.phase === "string") return renderWorkflowLike(result);
  return renderFallback(result);
}

function renderSelection(topics: string[]): string {
  if (topics.length === 0) return "No runtime-managed workflows found.";
  return ["Select a workflow topic to resume or inspect:", ...topics.map((topic) => `- ${topic}: /brainstorm-pro --resume ${topic} | /brainstorm-pro --status ${topic}`)].join("\n");
}

function renderWorkflowLike(state: Record<string, unknown>): string {
  const lines = renderSummary(state);
  const pending = objectValue(state.pendingDecision);
  const designStatus = objectValue(objectValue(state.reviewStatus)?.design);
  const planStatus = objectValue(objectValue(state.reviewStatus)?.plan);
  if (pending?.type === "review-decision" && pending.target === "design") lines.push(...renderDesignReviewDecision(pending));
  if (designStatus) lines.push(...renderDesignReviewStatus(designStatus));
  if (pending?.type === "approval" && pending.gate === "design") lines.push(...renderDesignApproval(pending, designStatus));
  lines.push(...renderRevisionHandoff(objectValue(state.revisionHandoff) ?? objectValue(designStatus?.revisionHandoff)));
  const planReviewStatus = objectValue(state.planReviewStatus);
  if (planReviewStatus || objectValue(planStatus?.planReview)) lines.push(...renderPlanReview(planReviewStatus, objectValue(planStatus?.planReview), state));
  if (pending?.type === "approval" && pending.gate === "plan") lines.push(...renderPlanApproval(pending, planReviewStatus, objectValue(planStatus?.planReview), state));
  if (state.phase === "blocked") lines.push(...renderBlocked(state));
  if (state.phase === "failed") lines.push(...renderFailed(state));
  if (state.phase === "done") lines.push(...renderDone(state));

  const artifacts = collectArtifacts(state);
  if (artifacts.length > 0) lines.push("Artifacts:", ...artifacts.map((artifact) => `- ${formatArtifactRef(artifact)}`));
  const lastError = isWorkflowError(state.lastError) ? state.lastError : undefined;
  if (lastError && state.phase !== "blocked" && state.phase !== "failed") lines.push(...renderLastError(lastError));
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

function renderSummary(state: Record<string, unknown>): string[] {
  const pending = objectValue(state.pendingDecision);
  return [`Workflow ${stringValue(state.topic) ?? "status"}`, stringValue(state.runId) ? `Run: ${stringValue(state.runId)}` : undefined, `Phase: ${state.phase}`, pending && typeof pending.type === "string" ? `Pending: ${pending.type}` : undefined].filter((line): line is string => Boolean(line));
}

function renderDesignReviewDecision(pending: Record<string, unknown>): string[] {
  const lines = ["", "Design review decision gate:"];
  const artifacts = arrayValue(pending.artifacts).filter(isArtifactRef);
  if (artifacts[0]) lines.push(`Current design: ${formatArtifactRef(artifacts[0])}`);
  const choices = arrayValue(pending.choices).filter((choice): choice is string => typeof choice === "string");
  if (choices.length) lines.push(`Available choices: ${choices.join(", ")}`);
  if (choices.includes("skip")) lines.push("- skip: explicit user-selected review decision; not an implicit no-op.");
  if (choices.includes("minimal")) lines.push("- minimal: runs the workflow-owned lightweight design review.");
  if (choices.includes("full")) {
    lines.push("- full: runs the five package-owned full reviewer roles by default:");
    for (const [role, description] of Object.entries(fullDesignReviewerDescriptions)) lines.push(`  - ${role}: ${description}`);
  }
  if (choices.includes("revise")) lines.push("- revise: return to design revision instead of choosing a review depth.");
  if (choices.includes("exit")) lines.push("- exit: leave the workflow at this gate.");
  lines.push("Reviewer selection binds to the exact current design version/checksum and becomes stale if the design changes.");
  return lines;
}

function renderDesignReviewStatus(status: Record<string, unknown>): string[] {
  const lines: string[] = ["", "Design review status:"];
  lines.push(`- Mode: ${stringValue(status.mode) ?? "unknown"}`);
  lines.push(`- Status: ${stringValue(status.status) ?? "unknown"}`);
  if (stringValue(status.readinessStatus)) lines.push(`- Readiness: ${stringValue(status.readinessStatus)}`);
  if (stringValue(status.triageSummary)) lines.push(`- Triage summary: ${stringValue(status.triageSummary)}`);
  if (stringValue(status.reason)) lines.push(`- Reason: ${stringValue(status.reason)}`);
  const coverage = objectValue(status.coverage);
  if (coverage) lines.push(...renderCoverage(coverage));
  const actions = arrayValue(status.recoveryActions).filter(isObject);
  const retryActions = actions.filter((action) => stringValue(action.type)?.includes("retry"));
  if (retryActions.length) lines.push(`- Retry recovery actions: ${retryActions.map(formatAction).join("; ")}`);
  const acceptActions = actions.filter((action) => stringValue(action.type) === "accept-incomplete-review");
  if (acceptActions.length) lines.push(...renderAcceptIncomplete(acceptActions[0], status));
  const viewLedger = actions.find((action) => stringValue(action.type) === "view-review-ledger");
  if (viewLedger) lines.push(`- Review ledger: ${stringValue(viewLedger.ledgerPath) ?? "available"}`);
  const incomplete = status.status === "partial" || status.readinessStatus === "incomplete-review";
  if (incomplete) lines.push("Partial or incomplete review is not a passed review and is not approval readiness.");
  return lines;
}

function renderCoverage(coverage: Record<string, unknown>): string[] {
  return ["- Coverage:", `  - Selected: ${formatStringArray(coverage.selectedReviewers)}`, `  - Unselected: ${formatStringArray(coverage.unselectedReviewers)}`, `  - Succeeded: ${formatStringArray(coverage.succeededReviewers)}`, `  - Failed: ${formatStringArray(coverage.failedReviewers)}`];
}

function renderAcceptIncomplete(action: Record<string, unknown>, status: Record<string, unknown>): string[] {
  const coverage = objectValue(action.coverage) ?? objectValue(status.coverage);
  const lines = ["", "Accept-incomplete warning:"];
  const ref = isArtifactRef(action.designRef) ? action.designRef : arrayValue(status.artifacts).find(isArtifactRef);
  if (ref) lines.push(`- Exact design binding: ${formatArtifactRef(ref)}`);
  if (coverage) {
    lines.push(`- Incomplete coverage: ${String(objectValue(coverage)?.hasIncompleteCoverage ?? "unknown")}`);
    lines.push(`- Succeeded reviewers: ${formatStringArray(objectValue(coverage)?.succeededReviewers)}`);
    lines.push(`- Failed reviewers: ${formatStringArray(objectValue(coverage)?.failedReviewers)}`);
  }
  if (stringValue(status.triageSummary)) lines.push(`- Aggregated findings summary: ${stringValue(status.triageSummary)}`);
  lines.push("Accepting incomplete coverage does not approve the design.");
  lines.push("It only allows movement to the separate design approval gate.");
  return lines;
}

function renderDesignApproval(pending: Record<string, unknown>, status?: Record<string, unknown>): string[] {
  const lines = ["", "Design approval gate:"];
  const ref = arrayValue(pending.artifacts).find(isArtifactRef);
  if (ref) lines.push(`Design artifact: ${formatArtifactRef(ref)}`);
  const choices = arrayValue(pending.choices).filter((choice): choice is string => typeof choice === "string");
  if (choices.length) lines.push(`Approval choices: ${choices.join(", ")}`);
  lines.push("Design approval is a separate explicit user gate.");
  if (status) {
    lines.push(`Review mode/status/readiness: ${stringValue(status.mode) ?? "unknown"}/${stringValue(status.status) ?? "unknown"}/${stringValue(status.readinessStatus) ?? "unknown"}`);
    const triage = objectValue(status.triage);
    if (triage) lines.push(`Triage counts: must-fix=${numberLike(triage.mustFix)}, should-fix=${numberLike(triage.shouldFix)}, note=${numberLike(triage.notes)}, conflicts=${numberLike(triage.conflicts)}, unresolved-questions=${numberLike(triage.unresolvedQuestions)}`);
    if (status.status === "skipped") lines.push("Warning: design review was explicitly skipped; approval is still required.");
    if (arrayValue(status.recoveryActions).some((action) => objectValue(action)?.type === "accept-incomplete-review")) lines.push("Warning: incomplete review coverage may be accepted only before this separate explicit approval gate.");
  }
  return lines;
}

function renderRevisionHandoff(handoff?: Record<string, unknown>): string[] {
  if (!handoff) return [];
  const lines = ["", "Revision handoff:", `- Revision id: ${stringValue(handoff.revisionId) ?? "unknown"}`];
  if (isArtifactRef(handoff.revisedDesignRef)) lines.push(`- Revised design: ${formatArtifactRef(handoff.revisedDesignRef)}`);
  if (stringValue(handoff.postRevisionReviewRunId)) lines.push(`- Post-revision review run: ${stringValue(handoff.postRevisionReviewRunId)}`);
  lines.push(`- Blocking question ids: ${formatStringArray(handoff.blockingQuestionIds)}`);
  lines.push("Old review/triage evidence is provenance only and cannot approve the revised design ref.");
  return lines;
}

function renderPlanReview(status: Record<string, unknown> | undefined, planReview: Record<string, unknown> | undefined, state: Record<string, unknown>): string[] {
  const lines = ["", "Automatic plan review:"];
  const artifacts = collectArtifacts(state);
  for (const kind of ["design", "requirements", "tasks"]) {
    const ref = artifacts.find((artifact) => artifact.kind === kind);
    if (ref) lines.push(`- ${kind}: ${formatArtifactRef(ref)}`);
  }
  if (stringValue(planReview?.reviewRunId)) lines.push(`- Plan review run: ${stringValue(planReview?.reviewRunId)}`);
  if (stringValue(status?.ledgerPath ?? planReview?.ledgerPath)) lines.push(`- Ledger: ${stringValue(status?.ledgerPath ?? planReview?.ledgerPath)}`);
  if (stringValue(status?.readinessStatus ?? planReview?.readinessStatus)) lines.push(`- Readiness: ${stringValue(status?.readinessStatus ?? planReview?.readinessStatus)}`);
  lines.push(`- Fixed reviewers: ${fixedPlanReviewers.join(", ")}`);
  lines.push("Plan review is automatic and fixed; there is no skip, minimal, or full user mode.");
  if (stringValue(status?.revisionAttemptStatus)) lines.push(`- Automatic revision attempt: ${stringValue(status?.revisionAttemptStatus)}`);
  if (stringValue(status?.postRevisionReviewStatus)) lines.push(`- Post-revision review status: ${stringValue(status?.postRevisionReviewStatus)}`);
  return lines;
}

function renderPlanApproval(pending: Record<string, unknown>, status: Record<string, unknown> | undefined, planReview: Record<string, unknown> | undefined, state: Record<string, unknown>): string[] {
  const readiness = stringValue(status?.readinessStatus ?? planReview?.readinessStatus);
  const lines = ["", "Plan approval gate:"];
  lines.push(`Plan review readiness: ${readiness ?? "unknown"}`);
  const choices = arrayValue(pending.choices).filter((choice): choice is string => typeof choice === "string");
  if (choices.length) lines.push(`Approval choices: ${choices.join(", ")}`);
  const reviewed = arrayValue(planReview?.reviewedArtifacts).filter(isArtifactRef);
  if (reviewed.length) lines.push("Reviewed refs:", ...reviewed.map((ref) => `- ${formatArtifactRef(ref)}`));
  const latest = collectArtifacts(state).filter((ref) => ref.kind === "requirements" || ref.kind === "tasks");
  if (latest.length) lines.push("Latest refs:", ...latest.map((ref) => `- ${formatArtifactRef(ref)}`));
  lines.push("Runtime will validate plan approval against the latest ready automatic plan review binding.");
  if (readiness && readiness !== "ready-for-plan-approval") lines.push("Diagnostics only: plan approval is not presented as executable unless this runtime phase and pending decision permit it.");
  return lines;
}

function renderBlocked(state: Record<string, unknown>): string[] {
  const lines = ["", "Blocked workflow diagnostics:"];
  const error = isWorkflowError(state.lastError) ? state.lastError : undefined;
  if (error) lines.push(...renderLastError(error));
  lines.push("Safe next commands: /brainstorm-pro --status <topic> or /brainstorm-pro --resume <topic> to re-render diagnostics; no automatic advancement is implied.");
  return lines;
}

function renderFailed(state: Record<string, unknown>): string[] {
  const lines = ["", "Failed workflow diagnostics:"];
  const error = isWorkflowError(state.lastError) ? state.lastError : undefined;
  if (error) lines.push(...renderLastError(error));
  lines.push("No retry, approval, or recovery action is executable unless runtime status explicitly exposes one.");
  return lines;
}

function renderDone(state: Record<string, unknown>): string[] {
  return ["", "Workflow is terminal: done.", `Topic: ${stringValue(state.topic) ?? "unknown"}`, stringValue(state.runId) ? `Run: ${stringValue(state.runId)}` : undefined, "No resume-next action is available for a completed workflow."].filter((line): line is string => Boolean(line));
}

function collectArtifacts(state: Record<string, unknown>): VersionedArtifactRef[] {
  const artifacts: VersionedArtifactRef[] = [];
  const add = (value: unknown) => {
    if (isArtifactRef(value) && !artifacts.some((artifact) => artifact.kind === value.kind && artifact.version === value.version && artifact.checksum === value.checksum)) artifacts.push(value);
  };
  if (isObject(state.artifacts)) Object.values(state.artifacts).forEach(add);
  const pending = objectValue(state.pendingDecision);
  arrayValue(pending?.artifacts).forEach(add);
  const reviewStatus = objectValue(state.reviewStatus);
  for (const status of Object.values(reviewStatus ?? {})) if (isObject(status)) arrayValue(status.artifacts).forEach(add);
  return artifacts;
}

function formatArtifactRef(ref: VersionedArtifactRef): string {
  const checksum = ref.checksum.length > 12 ? `${ref.checksum.slice(0, 12)}…` : ref.checksum;
  return `${ref.kind} v${ref.version} ${ref.path} checksum ${checksum}`;
}

function renderLastError(error: WorkflowErrorSnapshot): string[] {
  return ["Last error:", `- Message: ${error.message}`, `- Originating phase: ${error.phase}`, `- Recoverable: ${error.recoverable ? "yes" : "no"}`, error.details === undefined ? undefined : `- Details: ${safeJson(error.details)}`].filter((line): line is string => Boolean(line));
}

function renderFallback(result: unknown): string {
  if (result === undefined) return "No workflow status data returned.";
  return safeJson(result);
}

function safeJson(value: unknown): string {
  if (typeof value === "string") return value;
  const json = JSON.stringify(value, null, 2);
  return json ?? String(value);
}

function formatAction(action: Record<string, unknown>): string {
  return `${stringValue(action.type) ?? "action"}${stringValue(action.reviewRunId) ? ` (${stringValue(action.reviewRunId)})` : ""}`;
}

function formatStringArray(value: unknown): string {
  const values = arrayValue(value).filter((item): item is string => typeof item === "string");
  return values.length ? values.join(", ") : "none";
}

function numberLike(value: unknown): string {
  return typeof value === "number" ? String(value) : "unknown";
}

function isSelectionResult(value: unknown): value is { selectionRequired: string[] } {
  return isObject(value) && Array.isArray(value.selectionRequired) && value.selectionRequired.every((topic) => typeof topic === "string");
}

function isArtifactRef(value: unknown): value is VersionedArtifactRef {
  return isObject(value) && typeof value.kind === "string" && typeof value.version === "number" && typeof value.path === "string" && typeof value.checksum === "string" && typeof value.createdAt === "string";
}

function isWorkflowError(value: unknown): value is WorkflowErrorSnapshot {
  return isObject(value) && typeof value.message === "string" && typeof value.phase === "string" && typeof value.recoverable === "boolean" && typeof value.occurredAt === "string";
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
