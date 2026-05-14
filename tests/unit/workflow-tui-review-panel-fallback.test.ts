import assert from "node:assert/strict";
import test from "node:test";
import { renderReviewPanelFallback } from "../../extensions/clarification-orchestrator/tui/review-panel-fallback.ts";
import { visibleWorkflowWidth } from "../../extensions/clarification-orchestrator/tui/render-helpers.ts";
import type { ReviewPanelViewModel } from "../../extensions/clarification-orchestrator/tui/review-panel-view-model.ts";

const model: ReviewPanelViewModel = {
  topic: "topic",
  runId: "run-1",
  phase: "design-review",
  staleEvidence: [{ kind: "design-review", reason: "old checksum", provenanceOnly: true }],
  diagnostics: [{ level: "warning", code: "triage-unavailable", message: "Triage unavailable" }],
};

test("fallback is deterministic and includes safe hints", () => {
  const first = renderReviewPanelFallback(model, { width: 80 });
  const second = renderReviewPanelFallback(model, { width: 80 });
  assert.equal(first, second);
  assert.match(first, /Review summary/);
  assert.match(first, /\/brainstorm-pro --resume/);
  assert.match(first, /\/brainstorm-pro --status/);
});

test("fallback respects narrow width", () => {
  const output = renderReviewPanelFallback(model, { width: 40 });
  for (const line of output.split("\n")) assert.ok(visibleWorkflowWidth(line) <= 40, line);
});
