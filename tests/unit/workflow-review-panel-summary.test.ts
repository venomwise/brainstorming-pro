import assert from "node:assert/strict";
import test from "node:test";
import { artifactDisplayRefFromVersionedArtifact, createEmptyWorkflowReviewPanelSummary, formatArtifactDisplayRef, normalizeReviewPanelDiagnostic, type WorkflowReviewPanelSummary } from "../../extensions/clarification-orchestrator/workflow/review-panel-summary.ts";
import type { VersionedArtifactRef } from "../../extensions/clarification-orchestrator/workflow/types.ts";

test("creates an empty display-safe review panel summary", () => {
  const summary = createEmptyWorkflowReviewPanelSummary({ topic: "review-panel", runId: "run-1", generatedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(summary.topic, "review-panel");
  assert.equal(summary.runId, "run-1");
  assert.equal(summary.generatedAt, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(summary.staleEvidence, []);
  assert.equal(summary.diagnostics[0]?.code, "review-panel-empty");
});

test("normalizes diagnostics and preserves optional details", () => {
  const diagnostic = normalizeReviewPanelDiagnostic({ message: "checksum mismatch", details: { ref: "design" } });
  assert.equal(diagnostic.level, "warning");
  assert.equal(diagnostic.code, "review-panel-diagnostic");
  assert.deepEqual(diagnostic.details, { ref: "design" });
});

test("formats artifact display refs with checksum prefixes", () => {
  const artifact: VersionedArtifactRef = { kind: "design", version: 2, path: "specs/topic/design.md", checksum: "abcdef1234567890", createdAt: "now" };
  const ref = artifactDisplayRefFromVersionedArtifact(artifact, { label: "current design" });
  assert.equal(formatArtifactDisplayRef(ref), "current design v2@abcdef123456 specs/topic/design.md");
});

test("stale evidence summary shape is provenance-only", () => {
  const summary: WorkflowReviewPanelSummary = {
    topic: "topic",
    runId: "run",
    generatedAt: "now",
    staleEvidence: [{ kind: "design-review", reason: "design checksum changed", provenanceOnly: true, checksumMismatch: true }],
    diagnostics: [],
  };
  assert.equal(summary.staleEvidence[0]?.provenanceOnly, true);
  assert.equal(summary.staleEvidence[0]?.checksumMismatch, true);
});

test("summary contract does not expose mutation-like fields", () => {
  const summary = createEmptyWorkflowReviewPanelSummary({ topic: "topic", runId: "run" }) as unknown as Record<string, unknown>;
  const serialized = JSON.stringify(summary);
  for (const forbidden of ["approve", "retry", "acceptIncomplete", "authorizeRevision", "commitArtifact", "transition", "write"]) {
    assert.equal(serialized.includes(forbidden), false, `unexpected mutation-like field ${forbidden}`);
  }
});
