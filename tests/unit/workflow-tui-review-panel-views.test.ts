import assert from "node:assert/strict";
import test from "node:test";
import { renderReviewPanelView } from "../../extensions/clarification-orchestrator/tui/review-panel/index.ts";
import type { ReviewPanelViewModel } from "../../extensions/clarification-orchestrator/tui/review-panel-view-model.ts";

function model(overrides: Partial<ReviewPanelViewModel> = {}): ReviewPanelViewModel {
  return {
    topic: "topic",
    runId: "run-1",
    phase: "design-review",
    staleEvidence: [],
    diagnostics: [],
    designReview: {
      reviewRunId: "review-1",
      mode: "full",
      status: "partial",
      designRef: { kind: "design", version: 1, checksum: "abcdef1234567890", path: "specs/topic/design.md" },
      partial: true,
      incomplete: true,
      coverage: [
        { reviewerId: "product-reviewer", selected: true, status: "passed", findingCounts: { total: 0 } },
        { reviewerId: "architecture-reviewer", selected: true, status: "blocked", findingCounts: { total: 2 } },
        { reviewerId: "testing-reviewer", selected: false, status: "unselected" },
        { reviewerId: "unknown-reviewer", selected: true, status: "failed" },
      ],
      triage: { mustFix: [{ id: "m1", description: "Fix critical issue", sourceReviewerIds: ["architecture-reviewer"], affectedSections: ["API"] }], shouldFix: [], notes: [] },
      conflicts: [{ id: "c1", category: "scope", description: "reviewers disagree", consequence: "needs user decision" }],
      unresolvedQuestions: [{ id: "q1", prompt: "Which auth mode?", blocking: true, sourceContext: "security review" }],
      readiness: { status: "blocked", evidence: ["triage.json"] },
      ledgerLinks: [],
      diagnostics: [],
    },
    ...overrides,
  };
}

test("renders design review coverage, incomplete warning, unknown reviewer, triage, conflicts, questions, and readiness wording", () => {
  const output = renderReviewPanelView(model(), 120).join("\n");
  assert.match(output, /Design review review-1: partial/);
  assert.match(output, /product-reviewer/);
  assert.match(output, /architecture-reviewer/);
  assert.match(output, /Incomplete coverage is not a passed review/);
  assert.match(output, /This is not design approval/);
  assert.match(output, /unknown reviewer unknown-reviewer/);
  assert.match(output, /Must-fix/);
  assert.match(output, /Fix critical issue/);
  assert.match(output, /Conflicts/);
  assert.match(output, /Unresolved questions/);
  assert.match(output, /runtime-gated \/brainstorm-pro --resume/);
  assert.match(output, /Readiness is not approval/);
});

test("uses narrow one-reviewer-per-line coverage", () => {
  const output = renderReviewPanelView(model(), 50).join("\n");
  assert.match(output, /product-reviewer: selected, passed/);
});

test("passed review text remains distinct from approval", () => {
  const base = model();
  const output = renderReviewPanelView({ ...base, designReview: base.designReview ? { ...base.designReview, status: "passed", partial: false, incomplete: false } : undefined }, 120).join("\n");
  assert.match(output, /Passed design review is not design approval/);
});

test("absent triage does not classify raw findings", () => {
  const base = model();
  const output = renderReviewPanelView({ ...base, designReview: base.designReview ? { ...base.designReview, triage: undefined } : undefined }, 120).join("\n");
  assert.match(output, /Triage unavailable/);
  assert.doesNotMatch(output, /Fix critical issue/);
});

test("renders design revision, stale evidence, fixed plan review, and automatic revision", () => {
  const output = renderReviewPanelView({
    ...model({ designReview: undefined }),
    designRevision: {
      currentDesignRef: { kind: "design", version: 2, checksum: "222222222222" },
      latestRevision: { revisionId: "rev-1", status: "running", sourceDesignRef: { kind: "design", version: 1, checksum: "111111111111" }, sourceReviewRunId: "review-1", postRevisionReviewRunId: "review-2" },
      diagnostics: [],
    },
    staleEvidence: [{ kind: "design-review", reason: "design changed", provenanceOnly: true, currentArtifactRefs: [{ kind: "design", version: 2, checksum: "222222222222" }], staleArtifactRefs: [{ kind: "design", version: 1, checksum: "111111111111" }], checksumMismatch: true }],
    planReview: {
      reviewRunId: "plan-review-1",
      status: "blocked",
      approvedDesignRef: { kind: "design", version: 2, checksum: "222222222222" },
      requirementsRef: { kind: "requirements", version: 1, checksum: "333333333333" },
      tasksRef: { kind: "tasks", version: 1, checksum: "444444444444" },
      readiness: { status: "blocked-needs-plan-revision" },
      reviewers: [
        { reviewerId: "requirements-coverage-reviewer", status: "passed" },
        { reviewerId: "task-coverage-reviewer", status: "blocked", findingCounts: { total: 1 } },
        { reviewerId: "dependency-order-reviewer", status: "passed" },
      ],
      ledgerLinks: [],
      automaticRevision: { attemptNumber: 1, maxAttempts: 1, status: "exhausted", blockersRemaining: true, reason: "blockers remain" },
      diagnostics: [],
    },
  }, 140).join("\n");
  assert.match(output, /Revision is not design approval/);
  assert.match(output, /Old review evidence is provenance only/);
  assert.match(output, /cannot approve the current design artifact/);
  assert.match(output, /Plan review is automatic and fixed/);
  assert.match(output, /no skip\/minimal\/full mode and no reviewer subset selection/);
  assert.match(output, /requirements-coverage-reviewer/);
  assert.match(output, /task-coverage-reviewer/);
  assert.match(output, /dependency-order-reviewer/);
  assert.match(output, /Automatic plan revision: 1\/1 exhausted/);
  assert.match(output, /\/brainstorm-pro --resume/);
});
