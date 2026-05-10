import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AGENT_ROLE_DEFINITIONS, validateRoleForPhase } from "../../extensions/clarification-orchestrator/runtime/agent-execution/roles.ts";
import { createAgentRunError, emptyOutputCaptureSummary, type AgentRunRequest, type AgentRunResult } from "../../extensions/clarification-orchestrator/runtime/agent-execution/types.ts";
import { createWorkflowLayout, writeVersionedArtifact } from "../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { runDesignReviewPanel } from "../../extensions/clarification-orchestrator/workflow/adapters/design-review/panel.ts";
import { resolveFullDesignReviewerSet } from "../../extensions/clarification-orchestrator/workflow/adapters/design-review/full-reviewer-registry.ts";
import { normalizeDesignReviewFindings } from "../../extensions/clarification-orchestrator/workflow/adapters/design-review/finding-normalizer.ts";
import { designReviewerOutputSchema } from "../../extensions/clarification-orchestrator/workflow/adapters/design-review/schemas.ts";
import type { RunAgentFunction } from "../../extensions/clarification-orchestrator/workflow/adapters/agent-backed.ts";
import type { FullDesignReviewerRole } from "../../extensions/clarification-orchestrator/workflow/adapters/design-review/full-reviewer-registry.ts";
import type { WorkflowState } from "../../extensions/clarification-orchestrator/workflow/types.ts";

const fullRoles: FullDesignReviewerRole[] = [
  "product-reviewer",
  "architecture-reviewer",
  "risk-security-reviewer",
  "testing-reviewer",
  "scope-simplicity-reviewer",
];

async function fixture() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-design-review-security-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const ref = await writeVersionedArtifact(layout, "design", "# Design");
  const state: WorkflowState = {
    version: 1,
    runId: "run-1",
    topic: "my-topic",
    request: "x",
    phase: "design-review",
    createdAt: "now",
    updatedAt: "now",
    artifacts: { design: ref },
    reviewDecisions: { design: { id: "decision-1", target: "design", mode: "full", artifacts: [ref], selectedBy: "u", selectedAt: "now", path: ".workflow/decisions/design.json" } },
    reviewStatus: {},
    gates: {},
  };
  return { cwd, layout, ref, state };
}

test("full reviewer roles are rejected outside design-review", () => {
  for (const role of fullRoles) {
    assert.equal(validateRoleForPhase(role, "design-review").ok, true);
    const result = validateRoleForPhase(role, "planning");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "role-not-allowed");
  }
});

test("full reviewer roles use no-session and no-skills runtime policy", () => {
  for (const role of fullRoles) {
    const definition = AGENT_ROLE_DEFINITIONS[role];
    assert.equal(definition.allowSession, false);
    assert.equal(definition.allowSkills, false);
    assert.deepEqual(definition.allowedPhases, ["design-review"]);
    assert.equal(definition.expectedResultKind, "review-findings");
  }
});

test("full reviewer validation rejects lifecycle mutation directives and finding path escapes", async () => {
  assert.throws(() => designReviewerOutputSchema.validate({ summary: "x", confidence: "high", findings: [], approval: true }), /unauthorized directive/u);
  assert.throws(() => designReviewerOutputSchema.validate({ summary: "x", confidence: "high", findings: [], workflowState: { phase: "approved" } }), /unauthorized directive/u);
  const { ref, layout } = await fixture();
  assert.throws(
    () => normalizeDesignReviewFindings({
      reviewRunId: "review-1",
      designRef: ref,
      reviewerRole: "risk-security-reviewer",
      topicDir: layout.topicDir,
      findings: [{ category: "risk-security", severity: "blocking", title: "escape", description: "see ../outside", requiresRevision: true }],
    }),
    /parent-directory/u,
  );
});

test("full review partial failure cannot fallback to minimal", async () => {
  const { cwd, state } = await fixture();
  const seenRoles: string[] = [];
  const runAgent: RunAgentFunction = async <TOutput>(request: AgentRunRequest<TOutput>) => {
    seenRoles.push(request.role);
    if (request.role === "architecture-reviewer") {
      return {
        agentRunId: "agent-fail",
        role: request.role,
        status: "failed",
        paths: { agentRunDir: "/tmp/agent" },
        startedAt: "now",
        completedAt: "later",
        attempts: 1,
        attemptRecords: [],
        outputCapture: emptyOutputCaptureSummary(),
        error: createAgentRunError("non-zero-exit", "failed", { retryable: false }),
      } as unknown as AgentRunResult<TOutput>;
    }
    return {
      agentRunId: `agent-${request.role}`,
      role: request.role,
      status: "succeeded",
      output: { summary: "ok", confidence: "high", findings: [] },
      paths: { agentRunDir: "/tmp/agent" },
      startedAt: "now",
      completedAt: "later",
      attempts: 1,
      attemptRecords: [],
      outputCapture: emptyOutputCaptureSummary(),
    } as unknown as AgentRunResult<TOutput>;
  };

  const result = await runDesignReviewPanel(state, { projectRoot: cwd, model: "test:model", runAgent });
  assert.equal(result.status, "partial");
  assert.equal(result.readiness.status, "incomplete-review");
  assert.equal(seenRoles.includes("minimal-reviewer"), false);
  assert.deepEqual(seenRoles, resolveFullDesignReviewerSet().map((definition) => definition.role));
});
