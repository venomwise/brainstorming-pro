import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { createSpecPlanAdapter } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-plan.ts";
import { createInitialWorkflowState } from "../../../extensions/clarification-orchestrator/workflow/runtime.ts";
import type { AgentRunRequest, AgentRunResult } from "../../../extensions/clarification-orchestrator/runtime/agent-execution/types.ts";
import type { WorkflowState } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

const tasksMarkdown = `# Implementation Plan

## Overview
x

## Tasks

- [ ] 1. Phase 1: Build
  - [ ] 1.1 Implement
    - _Requirements: 1.1_
`;

async function tempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bp-plan-adapter-"));
}

async function approvedState(cwd: string): Promise<WorkflowState> {
  const state = createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" });
  const design = await writeVersionedArtifact(await createWorkflowLayout(cwd, "my-topic"), "design", "# Design\n");
  return {
    ...state,
    phase: "planning",
    artifacts: { design },
    reviewDecisions: { design: { id: "d", target: "design", mode: "skip", artifacts: [design], selectedBy: "u", selectedAt: "now", path: ".workflow/decisions/design.json" } },
    reviewStatus: { design: { target: "design", mode: "skip", status: "skipped", artifacts: [design] } },
    gates: { design: { gate: "design", artifacts: [design], approvedBy: "u", approvedAt: "now", path: ".workflow/approvals/design-approval.json" } },
  };
}

test("spec-plan adapter invokes plan-author and returns commit request", async () => {
  const cwd = await tempProject();
  const state = await approvedState(cwd);
  let captured: AgentRunRequest<unknown> | undefined;
  const adapter = createSpecPlanAdapter({
    projectRoot: cwd,
    model: "openai:test",
    async runAgent<TOutput>(request: AgentRunRequest<TOutput>) {
      captured = request as AgentRunRequest<unknown>;
      return { agentRunId: "a", role: request.role, status: "succeeded", output: { kind: "plan-draft", topic: "my-topic", requirementsMarkdown: "# Requirements\n", tasksMarkdown, traceability: [{ requirementId: "1.1", taskIds: ["1.1"] }], assumptions: [], risks: [] } as TOutput, paths: { agentRunDir: cwd }, startedAt: "now", completedAt: "now", attempts: 1, attemptRecords: [], outputCapture: { stdoutBytes: 0, stderrBytes: 0, rawOutputBytes: 0, stdoutTruncated: false, stderrTruncated: false, rawOutputTruncated: false } } satisfies AgentRunResult<TOutput>;
    },
  });
  const result = await adapter.run(state, state);
  assert.equal(captured?.role, "plan-author");
  assert.equal(captured?.workflow.phase, "planning");
  assert.match(captured?.prompt ?? "", /Approved design artifact/u);
  assert.match(captured?.systemPrompt ?? "", /plan-author/u);
  assert.equal(result.kind, "artifact-commit-request");
  assert.deepEqual(result.kind === "artifact-commit-request" && result.artifacts.map((artifact) => artifact.kind), ["requirements", "tasks"]);
});

test("spec-plan adapter blocks before child invocation without approval", async () => {
  const cwd = await tempProject();
  const state = createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" });
  let called = false;
  const adapter = createSpecPlanAdapter({ projectRoot: cwd, model: "openai:test", async runAgent<TOutput>(request: AgentRunRequest<TOutput>) { called = true; throw new Error(`unexpected ${request.role}`); } });
  const result = await adapter.run({ ...state, phase: "planning" }, state);
  assert.equal(called, false);
  assert.equal(result.kind, "blocked");
});

test("spec-plan adapter fails closed on child failure", async () => {
  const cwd = await tempProject();
  const state = await approvedState(cwd);
  const adapter = createSpecPlanAdapter({
    projectRoot: cwd,
    model: "openai:test",
    async runAgent(request) {
      return { agentRunId: "a", role: request.role, status: "invalid-output", error: { kind: "schema-validation-failed", message: "bad", retryable: false }, paths: { agentRunDir: cwd }, startedAt: "now", completedAt: "now", attempts: 1, attemptRecords: [], outputCapture: { stdoutBytes: 0, stderrBytes: 0, rawOutputBytes: 0, stdoutTruncated: false, stderrTruncated: false, rawOutputTruncated: false } };
    },
  });
  const result = await adapter.run(state, state);
  assert.equal(result.kind, "failed");
  await assert.rejects(fs.readFile(path.join(cwd, "specs", "my-topic", "requirements.md"), "utf8"), /ENOENT/u);
});
