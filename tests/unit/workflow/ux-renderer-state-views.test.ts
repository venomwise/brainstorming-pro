import test from "node:test";
import assert from "node:assert/strict";
import { renderWorkflowUxResult } from "../../../extensions/clarification-orchestrator/workflow/ux-renderer.ts";
import type { VersionedArtifactRef } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

const designRef: VersionedArtifactRef = { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "designchecksum123", createdAt: "2026-05-12T00:00:00.000Z" };
const revisedDesignRef: VersionedArtifactRef = { ...designRef, version: 2, path: ".workflow/artifacts/design/v2.md", checksum: "revisedchecksum" };
const requirementsRef: VersionedArtifactRef = { kind: "requirements", version: 1, path: ".workflow/artifacts/requirements/v1.md", checksum: "reqchecksum", createdAt: "2026-05-12T00:00:00.000Z" };
const tasksRef: VersionedArtifactRef = { kind: "tasks", version: 1, path: ".workflow/artifacts/tasks/v1.md", checksum: "taskchecksum", createdAt: "2026-05-12T00:00:00.000Z" };

const base = { topic: "ux-topic", runId: "run-1", artifacts: { design: designRef, requirements: requirementsRef, tasks: tasksRef }, reviewStatus: {} };

test("design review decision output includes binding, choices, explanations, reviewers, and stale warning", () => {
  const output = renderWorkflowUxResult({ ...base, phase: "awaiting-design-review-decision", pendingDecision: { type: "review-decision", target: "design", artifacts: [designRef], choices: ["skip", "minimal", "full", "revise", "exit"] } });
  assert.match(output, /Design review decision gate/);
  assert.match(output, /design v1 .*checksum designchecks/);
  assert.match(output, /Available choices: skip, minimal, full, revise, exit/);
  assert.match(output, /explicit user-selected review decision/);
  assert.match(output, /workflow-owned lightweight design review/);
  for (const role of ["product-reviewer", "architecture-reviewer", "risk-security-reviewer", "testing-reviewer", "scope-simplicity-reviewer"]) assert.match(output, new RegExp(role));
  assert.match(output, /binds to the exact current design version\/checksum.*stale/i);
});

test("partial design review output includes coverage and not-passed warning", () => {
  const output = renderWorkflowUxResult({ ...base, phase: "blocked", reviewStatus: { design: { target: "design", mode: "full", status: "partial", artifacts: [designRef], readinessStatus: "incomplete-review", triageSummary: "one reviewer failed", coverage: { selectedReviewers: ["product-reviewer", "testing-reviewer"], unselectedReviewers: ["architecture-reviewer"], succeededReviewers: ["product-reviewer"], failedReviewers: ["testing-reviewer"], hasIncompleteCoverage: true }, recoveryActions: [{ type: "view-review-ledger", reviewRunId: "review-1", ledgerPath: ".workflow/reviews/design/review-1" }] } } });
  assert.match(output, /Design review status/);
  assert.match(output, /Selected: product-reviewer, testing-reviewer/);
  assert.match(output, /Unselected: architecture-reviewer/);
  assert.match(output, /Succeeded: product-reviewer/);
  assert.match(output, /Failed: testing-reviewer/);
  assert.match(output, /not a passed review and is not approval readiness/);
  assert.doesNotMatch(output, /Approval choices: approve/);
});

test("failed reviewer retry and accept-incomplete warnings only appear when runtime exposes actions", () => {
  const withoutActions = renderWorkflowUxResult({ ...base, phase: "blocked", reviewStatus: { design: { target: "design", mode: "full", status: "partial", artifacts: [designRef], coverage: { succeededReviewers: ["product-reviewer"], failedReviewers: ["testing-reviewer"] } } } });
  assert.doesNotMatch(withoutActions, /Retry recovery actions/);
  assert.doesNotMatch(withoutActions, /Accept-incomplete warning/);

  const withActions = renderWorkflowUxResult({ ...base, phase: "blocked", reviewStatus: { design: { target: "design", mode: "full", status: "partial", artifacts: [designRef], readinessStatus: "incomplete-review", triageSummary: "no blockers", coverage: { succeededReviewers: ["product-reviewer"], failedReviewers: ["testing-reviewer"], hasIncompleteCoverage: true }, recoveryActions: [{ type: "retry-failed-reviewers", reviewRunId: "review-1", reviewerRoles: ["testing-reviewer"] }, { type: "accept-incomplete-review", reviewRunId: "review-1", designRef, coverage: { succeededReviewers: ["product-reviewer"], failedReviewers: ["testing-reviewer"], hasIncompleteCoverage: true } }] } } });
  assert.match(withActions, /Retry recovery actions/);
  assert.match(withActions, /Accept-incomplete warning/);
  assert.match(withActions, /does not approve the design/);
  assert.match(withActions, /separate design approval gate/);
});

test("design approval and revision handoff views include summaries and warnings", () => {
  const output = renderWorkflowUxResult({
    ...base,
    phase: "awaiting-design-approval",
    pendingDecision: { type: "approval", gate: "design", artifacts: [revisedDesignRef], choices: ["approve", "revise", "status", "exit"] },
    revisionHandoff: { revisionId: "rev-1", revisedDesignRef, postRevisionReviewRunId: "review-2", blockingQuestionIds: ["q1"] },
    reviewStatus: { design: { target: "design", mode: "full", status: "passed", artifacts: [revisedDesignRef], readinessStatus: "ready-for-user-approval", triageSummary: "passed", triage: { mustFix: 0, shouldFix: 1, notes: 2, conflicts: 0, unresolvedQuestions: 1 } } },
  });
  assert.match(output, /Design approval gate/);
  assert.match(output, /Approval choices: approve, revise, status, exit/);
  assert.match(output, /separate explicit user gate/);
  assert.match(output, /must-fix=0, should-fix=1, note=2, conflicts=0, unresolved-questions=1/);
  assert.match(output, /Revision handoff/);
  assert.match(output, /Revision id: rev-1/);
  assert.match(output, /Post-revision review run: review-2/);
  assert.match(output, /provenance only and cannot approve/);
});

test("plan review, plan approval, blocked, failed, and done views are safe", () => {
  const plan = renderWorkflowUxResult({ ...base, phase: "awaiting-plan-approval", pendingDecision: { type: "approval", gate: "plan", artifacts: [requirementsRef, tasksRef], choices: ["approve", "revise", "status", "exit"] }, reviewStatus: { plan: { target: "plan", mode: "minimal", status: "passed", artifacts: [requirementsRef, tasksRef], planReview: { automatic: true, reviewRunId: "plan-review-1", ledgerPath: ".workflow/reviews/plan/plan-review-1", readinessStatus: "ready-for-plan-approval", reviewedArtifacts: [requirementsRef, tasksRef] } } } });
  assert.match(plan, /Automatic plan review/);
  for (const role of ["requirements-coverage-reviewer", "task-coverage-reviewer", "dependency-order-reviewer"]) assert.match(plan, new RegExp(role));
  assert.match(plan, /no skip, minimal, or full user mode/);
  assert.match(plan, /Plan approval gate/);
  assert.match(plan, /validate plan approval against the latest ready automatic plan review binding/);

  const blocked = renderWorkflowUxResult({ ...base, phase: "blocked", lastError: { message: "needs revision", phase: "plan-review", recoverable: true, occurredAt: "now" } });
  assert.match(blocked, /Blocked workflow diagnostics/);
  assert.match(blocked, /no automatic advancement is implied/);

  const failed = renderWorkflowUxResult({ ...base, phase: "failed", lastError: { message: "bad", phase: "planning", recoverable: false, occurredAt: "now" } });
  assert.match(failed, /Failed workflow diagnostics/);
  assert.match(failed, /No retry, approval, or recovery action/);

  const done = renderWorkflowUxResult({ ...base, phase: "done" });
  assert.match(done, /terminal: done/);
  assert.match(done, /No resume-next action/);
});
