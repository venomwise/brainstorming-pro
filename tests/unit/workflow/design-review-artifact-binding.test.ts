import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { bindDesignArtifactForReview } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/artifact-binding.ts";
import type { ReviewDecisionRef, WorkflowState } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

async function fixture() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-design-review-binding-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const ref = await writeVersionedArtifact(layout, "design", "# Design\n\ncontent");
  const state: WorkflowState = { version: 1, runId: "run-1", topic: "my-topic", request: "x", phase: "design-review", createdAt: "now", updatedAt: "now", artifacts: { design: ref }, reviewDecisions: {}, reviewStatus: {}, gates: {} };
  const decision: ReviewDecisionRef = { id: "design-1", target: "design", mode: "minimal", artifacts: [ref], selectedBy: "u", selectedAt: "now", path: ".workflow/decisions/design.json" };
  return { layout, state, decision, ref };
}

test("binds the exact latest design artifact", async () => {
  const { layout, state, decision } = await fixture();
  const bound = await bindDesignArtifactForReview(layout, state, decision);
  assert.equal(bound.ref.version, 1);
  assert.equal(bound.content, "# Design\n\ncontent");
});

test("rejects stale decisions checksum mismatches and path escapes", async () => {
  const { layout, state, decision, ref } = await fixture();
  assert.rejects(() => bindDesignArtifactForReview(layout, { ...state, artifacts: { design: { ...ref, version: 2 } } }, decision), /Stale design review decision/);
  await fs.writeFile(path.join(layout.topicDir, ref.path), "tampered");
  assert.rejects(() => bindDesignArtifactForReview(layout, state, decision), /checksum mismatch/);
  const escapedRef = { ...ref, path: "../escape.md" };
  const escapedState = { ...state, artifacts: { design: escapedRef } };
  const escapedDecision = { ...decision, artifacts: [escapedRef] };
  assert.rejects(() => bindDesignArtifactForReview(layout, escapedState, escapedDecision), /outside topic directory/);
});
