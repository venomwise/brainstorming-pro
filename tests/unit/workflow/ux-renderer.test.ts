import test from "node:test";
import assert from "node:assert/strict";
import { renderWorkflowUxResult } from "../../../extensions/clarification-orchestrator/workflow/ux-renderer.ts";
import type { VersionedArtifactRef } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

const designRef: VersionedArtifactRef = {
  kind: "design",
  version: 2,
  path: ".workflow/artifacts/design/v2.md",
  checksum: "abcdef1234567890",
  createdAt: "2026-05-12T00:00:00.000Z",
};

test("renders empty and populated selection views without advancement language", () => {
  assert.equal(renderWorkflowUxResult({ selectionRequired: [] }), "No runtime-managed workflows found.");
  const output = renderWorkflowUxResult({ selectionRequired: ["alpha-topic", "beta-topic"] });
  assert.match(output, /Select a workflow topic/);
  assert.match(output, /\/brainstorm-pro --resume alpha-topic/);
  assert.match(output, /\/brainstorm-pro --status beta-topic/);
  assert.doesNotMatch(output, /approved|passed|ready/i);
});

test("renders phase summary, pending decision, artifact refs, and last error", () => {
  const output = renderWorkflowUxResult({
    topic: "my-topic",
    runId: "run-1",
    phase: "blocked",
    pendingDecision: { type: "approval", gate: "design", artifacts: [designRef], choices: ["status"] },
    artifacts: { design: designRef },
    lastError: { message: "missing precondition", phase: "planning", recoverable: true, occurredAt: "2026-05-12T00:00:00.000Z", details: { code: "x" } },
  });
  assert.match(output, /Workflow my-topic/);
  assert.match(output, /Run: run-1/);
  assert.match(output, /Phase: blocked/);
  assert.match(output, /Pending: approval/);
  assert.match(output, /design v2 \.workflow\/artifacts\/design\/v2\.md checksum abcdef123456/);
  assert.match(output, /Message: missing precondition/);
  assert.match(output, /Originating phase: planning/);
  assert.match(output, /Recoverable: yes/);
});

test("uses safe deterministic fallback for unknown status shapes", () => {
  assert.equal(renderWorkflowUxResult(undefined), "No workflow status data returned.");
  assert.equal(renderWorkflowUxResult("diagnostic text"), "diagnostic text");
  const output = renderWorkflowUxResult({ unexpected: true });
  assert.equal(output, JSON.stringify({ unexpected: true }, null, 2));
  assert.doesNotMatch(output, /ready|passed|approved/i);
});
