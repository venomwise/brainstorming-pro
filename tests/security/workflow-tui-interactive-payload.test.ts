import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { submitWorkflowDecision } from "../../extensions/clarification-orchestrator/workflow/decision-facade.ts";
import { saveWorkflowState } from "../../extensions/clarification-orchestrator/workflow/runtime.ts";
import type { VersionedArtifactRef, WorkflowState } from "../../extensions/clarification-orchestrator/workflow/types.ts";

const design: VersionedArtifactRef = { kind: "design", version: 1, path: "design.md", checksum: "design-sha", createdAt: "2026-01-01T00:00:00.000Z" };

function state(): WorkflowState {
  return {
    version: 1,
    runId: "run-20260101-000000-test",
    topic: "interactive-security",
    request: "test",
    phase: "awaiting-design-approval",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    artifacts: { design },
    reviewDecisions: {},
    reviewStatus: {},
    gates: {},
    pendingDecision: { type: "approval", gate: "design", artifacts: [design], choices: ["approve", "revise", "status", "exit"], binding: { gateId: "design-approval", gateNonce: "nonce", phase: "awaiting-design-approval", artifactRefs: [design], createdAt: "2026-01-01T00:00:00.000Z" } },
  };
}

test("crafted stale artifact approval is rejected", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "workflow-tui-security-"));
  try {
    await saveWorkflowState(cwd, state());
    const result = await submitWorkflowDecision({ cwd, topic: "interactive-security", decision: { type: "approval", action: "approve", user: "u" }, binding: { gateId: "design-approval", gateNonce: "nonce", phase: "awaiting-design-approval", artifactRefs: [{ ...design, checksum: "stale" }] }, idempotency: { key: "k1" }, source: "tui" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "checksum-mismatch");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("accept incomplete without explicit confirmation is rejected", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "workflow-tui-security-"));
  try {
    await saveWorkflowState(cwd, state());
    const result = await submitWorkflowDecision({ cwd, topic: "interactive-security", decision: { type: "accept-incomplete-design-review", confirmed: false, user: "u" }, binding: { gateId: "design-approval", gateNonce: "nonce", phase: "awaiting-design-approval", artifactRefs: [design] }, idempotency: { key: "k2" }, source: "tui" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "unsupported-decision");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("crafted plan review mode payload is rejected", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "workflow-tui-security-"));
  try {
    await saveWorkflowState(cwd, state());
    const decision = { type: "approval", action: "approve", user: "u", planReviewMode: "skip" } as never;
    const result = await submitWorkflowDecision({ cwd, topic: "interactive-security", decision, binding: { gateId: "design-approval", gateNonce: "nonce", phase: "awaiting-design-approval", artifactRefs: [design] }, idempotency: { key: "k3" }, source: "tui" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "unsupported-decision");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
