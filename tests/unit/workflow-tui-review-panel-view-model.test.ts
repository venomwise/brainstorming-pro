import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewPanelViewModel } from "../../extensions/clarification-orchestrator/tui/review-panel-view-model.ts";
import type { WorkflowLiveSnapshot } from "../../extensions/clarification-orchestrator/workflow/progress-types.ts";
import type { WorkflowReviewPanelSummary } from "../../extensions/clarification-orchestrator/workflow/review-panel-summary.ts";

function snapshot(overrides: Partial<WorkflowLiveSnapshot> = {}): WorkflowLiveSnapshot {
  return {
    topic: "topic",
    runId: "run-1",
    phase: "design-review",
    phaseStatus: "running",
    version: 1,
    createdAt: "now",
    updatedAt: "now",
    stale: false,
    fallbackText: "running",
    timeline: [],
    artifacts: [],
    agents: [],
    reviewers: [{ reviewRunId: "review-1", target: "design", reviewerId: "product-reviewer", status: "running" }],
    tasks: [],
    gates: [],
    diagnostics: [],
    ...overrides,
  };
}

function summary(overrides: Partial<WorkflowReviewPanelSummary> = {}): WorkflowReviewPanelSummary {
  return {
    topic: "topic",
    runId: "run-1",
    generatedAt: "now",
    staleEvidence: [],
    diagnostics: [],
    designReview: {
      reviewRunId: "review-1",
      mode: "full",
      status: "passed",
      coverage: [{ reviewerId: "product-reviewer", selected: true, status: "passed", findingCounts: { total: 0 } }],
      triage: { mustFix: [{ id: "m1", description: "runtime supplied must fix" }], shouldFix: [], notes: [] },
      readiness: { status: "ready-for-design-approval", evidence: ["ledger"] },
    },
    ...overrides,
  };
}

test("maps normal summary fields", () => {
  const model = buildReviewPanelViewModel({ snapshot: snapshot(), summary: summary() });
  assert.equal(model.designReview?.status, "passed");
  assert.equal(model.designReview?.triage?.mustFix[0]?.description, "runtime supplied must fix");
  assert.equal(model.designReview?.readiness?.status, "ready-for-design-approval");
});

test("returns diagnostic-only model when summary is absent", () => {
  const model = buildReviewPanelViewModel({ snapshot: snapshot() });
  assert.equal(model.designReview, undefined);
  assert.equal(model.diagnostics[0]?.code, "review-panel-summary-unavailable");
});

test("durable summary status wins over live progress", () => {
  const model = buildReviewPanelViewModel({ snapshot: snapshot(), summary: summary() });
  assert.equal(model.designReview?.coverage[0]?.status, "passed");
  assert.equal(model.designReview?.coverage[0]?.liveStatusHint, undefined);
});

test("running durable summary may include live progress hint", () => {
  const model = buildReviewPanelViewModel({ snapshot: snapshot(), summary: summary({ designReview: { mode: "full", status: "running", coverage: [{ reviewerId: "product-reviewer", selected: true, status: "running" }] } }) });
  assert.equal(model.designReview?.coverage[0]?.status, "running");
  assert.equal(model.designReview?.coverage[0]?.liveStatusHint, "running");
});

test("context mismatch avoids presenting evidence as current", () => {
  const model = buildReviewPanelViewModel({ snapshot: snapshot(), summary: summary({ runId: "other" }) });
  assert.equal(model.designReview, undefined);
  assert.equal(model.diagnostics.some((diagnostic) => diagnostic.code === "review-panel-context-mismatch"), true);
});

test("missing triage/readiness and malformed subsection produce diagnostics", () => {
  const model = buildReviewPanelViewModel({ snapshot: snapshot(), summary: summary({ designReview: { mode: "full", status: "blocked", coverage: [] } }) });
  assert.equal(model.diagnostics.some((diagnostic) => diagnostic.code === "triage-unavailable"), true);
  assert.equal(model.diagnostics.some((diagnostic) => diagnostic.code === "readiness-unavailable"), true);
});

test("preserves stale evidence", () => {
  const model = buildReviewPanelViewModel({ snapshot: snapshot(), summary: summary({ staleEvidence: [{ kind: "design-review", reason: "old checksum", provenanceOnly: true }] }) });
  assert.equal(model.staleEvidence[0]?.provenanceOnly, true);
});
