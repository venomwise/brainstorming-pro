import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { renderReviewPanelView } from "../../extensions/clarification-orchestrator/tui/review-panel/index.ts";
import type { ReviewPanelViewModel } from "../../extensions/clarification-orchestrator/tui/review-panel-view-model.ts";

const reviewPanelFiles = [
  "extensions/clarification-orchestrator/tui/review-panel-view-model.ts",
  "extensions/clarification-orchestrator/tui/review-panel-fallback.ts",
  "extensions/clarification-orchestrator/tui/review-panel/index.ts",
  "extensions/clarification-orchestrator/tui/review-panel/design-review-view.ts",
  "extensions/clarification-orchestrator/tui/review-panel/triage-view.ts",
  "extensions/clarification-orchestrator/tui/review-panel/conflict-question-view.ts",
  "extensions/clarification-orchestrator/tui/review-panel/design-revision-view.ts",
  "extensions/clarification-orchestrator/tui/review-panel/stale-evidence-view.ts",
  "extensions/clarification-orchestrator/tui/review-panel/plan-review-view.ts",
];

test("review panel TUI modules do not import workflow mutation authorities", async () => {
  const forbidden = ["approval", "decision-facade", "ledger-writer", "revision-ledger", "artifact-store", "state-machine", "atomic-json", "task-checkbox", "fs/promises"];
  for (const file of reviewPanelFiles) {
    const content = await readFile(file, "utf8");
    for (const token of forbidden) assert.equal(content.includes(`from \"${token}`) || content.includes(`from \"../workflow/${token}`) || content.includes(`from \"../../workflow/${token}`), false, `${file} imports ${token}`);
  }
});

test("review panel renderers do not expose runtime decision or plan control labels", async () => {
  for (const file of reviewPanelFiles) {
    const content = await readFile(file, "utf8");
    for (const token of ["submitretry", "submitapprove", "submitauthorization", "acceptincomplete", "partialacceptbutton", "reviewersubsetselector", "builtin agent", "intercom", "arbitrary chain", "background runner"]) {
      assert.equal(content.toLowerCase().replace(/[^a-z]/g, "").includes(token.toLowerCase().replace(/[^a-z]/g, "")), false, `${file} exposes ${token}`);
    }
  }
});

test("rendering stale evidence writes no workflow files and remains provenance-only", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "review-panel-boundary-"));
  try {
    await writeFile(path.join(temp, "design.md"), "design\n");
    const model: ReviewPanelViewModel = { topic: "topic", runId: "run", phase: "design-review", diagnostics: [], staleEvidence: [{ kind: "design-review", reason: "old", provenanceOnly: true }] };
    const before = await readdir(temp);
    const output = renderReviewPanelView(model, 100).join("\n");
    const after = await readdir(temp);
    assert.deepEqual(after, before);
    assert.match(output, /provenance only/);
    assert.match(output, /cannot approve/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
