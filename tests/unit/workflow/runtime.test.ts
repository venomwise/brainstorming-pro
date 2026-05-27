import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowLayout, checksum } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { readWorkflowEvents } from "../../../extensions/clarification-orchestrator/workflow/events.ts";
import { WorkflowRuntimeOrchestrator, augmentWorkflow, createInitialWorkflowState, persistWorkflowAgentModel, saveWorkflowState, startWorkflow } from "../../../extensions/clarification-orchestrator/workflow/runtime.ts";
import type { VersionedArtifactRef } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

async function tempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bp-runtime-"));
}

const designRef: VersionedArtifactRef = { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "abc", createdAt: "2026-05-08T00:00:00.000Z" };

test("starts a workflow with isolated state", async () => {
  const cwd = await tempProject();
  const { state } = await startWorkflow({ cwd, agentModel: "openai/test", topic: "my-topic", request: "Build feature", runId: "run-1" });
  assert.equal(state.phase, "designing");
  assert.equal(state.runId, "run-1");
  assert.equal(state.agentModel, "openai/test");
  const persisted = JSON.parse(await fs.readFile(path.join(cwd, "specs", "my-topic", ".workflow", "runs", "run-1", "state.json"), "utf8")) as { agentModel?: string };
  assert.equal(persisted.agentModel, "openai/test");
});

test("augments an existing workflow with supplemental request context", async () => {
  const cwd = await tempProject();
  const initial = createInitialWorkflowState({ agentModel: "openai/test", topic: "my-topic", request: "Build", runId: "run-1" });
  await saveWorkflowState(cwd, { ...initial, phase: "awaiting-design-approval", artifacts: { design: designRef }, gates: { design: { gate: "design", artifacts: [designRef], approvedBy: "tester", approvedAt: "2026-05-08T00:00:00.000Z", path: ".workflow/approvals/design-approval.json" } } });
  const { state } = await augmentWorkflow({ cwd, topic: "my-topic", request: "Add audit trail", runId: "run-2", now: new Date("2026-05-08T01:00:00.000Z") });
  assert.equal(state.runId, "run-2");
  assert.equal(state.phase, "designing");
  assert.equal(state.request, "Add audit trail");
  assert.deepEqual(state.supplementalRequests, [{ request: "Add audit trail", receivedAt: "2026-05-08T01:00:00.000Z" }]);
  assert.equal(state.contextDesignPath, designRef.path);
  assert.equal(state.agentModel, "openai/test");
  assert.deepEqual(state.reviewDecisions, {});
  assert.deepEqual(state.reviewStatus, {});
  assert.deepEqual(state.gates, {});
});

test("patches legacy workflow agent model", async () => {
  const cwd = await tempProject();
  const initial = createInitialWorkflowState({ agentModel: "openai/test", topic: "my-topic", request: "Build", runId: "run-1" });
  const { agentModel: _legacyRemoved, ...legacyState } = initial;
  await saveWorkflowState(cwd, legacyState);

  const patched = await persistWorkflowAgentModel(cwd, "my-topic", "anthropic/claude-sonnet-4");
  assert.equal(patched.agentModel, "anthropic/claude-sonnet-4");
  assert.equal(patched.phase, "designing");
  const persisted = JSON.parse(await fs.readFile(path.join(cwd, "specs", "my-topic", ".workflow", "runs", "run-1", "state.json"), "utf8")) as { agentModel?: string };
  assert.equal(persisted.agentModel, "anthropic/claude-sonnet-4");

  await assert.rejects(() => persistWorkflowAgentModel(cwd, "my-topic", "gpt-4o-mini"), /Legacy workflow still lacks a valid agentModel: Model 'gpt-4o-mini' is not provider-qualified/);
  const afterRejectedPatch = JSON.parse(await fs.readFile(path.join(cwd, "specs", "my-topic", ".workflow", "runs", "run-1", "state.json"), "utf8")) as { agentModel?: string; phase?: string };
  assert.equal(afterRejectedPatch.agentModel, "anthropic/claude-sonnet-4");
  assert.equal(afterRejectedPatch.phase, "designing");
});

test("default runtime adapters fail closed without workflow agent model", async () => {
  const cwd = await tempProject();
  const initial = createInitialWorkflowState({ agentModel: "openai/test", topic: "my-topic", request: "Build", runId: "run-1" });
  const { agentModel: _legacyRemoved, ...legacyState } = initial;
  await saveWorkflowState(cwd, legacyState);

  await assert.rejects(
    () => new WorkflowRuntimeOrchestrator(cwd, { useDefaultAdapters: true }).resumeWorkflow("my-topic"),
    /Workflow agent model is required before running agent-backed phases/u,
  );
});

test("default runtime adapters reject invalid workflow agent model before execution", async () => {
  const cwd = await tempProject();
  const initial = createInitialWorkflowState({ agentModel: "openai/test", topic: "my-topic", request: "Build", runId: "run-1" });
  await saveWorkflowState(cwd, { ...initial, agentModel: "gpt-4o-mini" });

  await assert.rejects(
    () => new WorkflowRuntimeOrchestrator(cwd, { useDefaultAdapters: true }).resumeWorkflow("my-topic"),
    /Expected format '<provider>\/<model>'/u,
  );
});

test("renders review decision and applies skip", async () => {
  const cwd = await tempProject();
  const state = createInitialWorkflowState({ agentModel: "openai/test", topic: "my-topic", request: "Build", runId: "run-1" });
  await saveWorkflowState(cwd, { ...state, phase: "awaiting-design-review-decision", artifacts: { design: designRef } });
  const runtime = new WorkflowRuntimeOrchestrator(cwd);
  const pending = await runtime.resumeWorkflow("my-topic");
  assert.equal("phase" in pending && pending.phase, "awaiting-design-review-decision");
  assert.equal("pendingDecision" in pending && pending.pendingDecision?.type, "review-decision");
  const advanced = await runtime.resumeWorkflow("my-topic", { type: "review-mode", mode: "skip", user: "tester" });
  assert.equal("phase" in advanced && advanced.phase, "awaiting-design-approval");
});

test("full review decision routes to design-review for explicit adapter handling", async () => {
  const cwd = await tempProject();
  const state = createInitialWorkflowState({ agentModel: "openai/test", topic: "my-topic", request: "Build", runId: "run-1" });
  await saveWorkflowState(cwd, { ...state, phase: "awaiting-design-review-decision", artifacts: { design: designRef } });
  const result = await new WorkflowRuntimeOrchestrator(cwd).resumeWorkflow("my-topic", { type: "review-mode", mode: "full", user: "tester" });
  assert.equal("phase" in result && result.phase, "design-review");
  assert.equal("reviewDecisions" in result && result.reviewDecisions.design?.mode, "full");
  assert.equal("reviewStatus" in result && result.reviewStatus.design, undefined);
});

test("approval advances design gate to planning", async () => {
  const cwd = await tempProject();
  const state = createInitialWorkflowState({ agentModel: "openai/test", topic: "my-topic", request: "Build", runId: "run-1" });
  await saveWorkflowState(cwd, { ...state, phase: "awaiting-design-approval", artifacts: { design: designRef } });
  const result = await new WorkflowRuntimeOrchestrator(cwd).resumeWorkflow("my-topic", { type: "approval", action: "approve", user: "tester" });
  assert.equal("phase" in result && result.phase, "planning");
});

test("adapter artifact commit requests are committed by runtime", async () => {
  const cwd = await tempProject();
  const runtime = new WorkflowRuntimeOrchestrator(cwd, {
    adapters: {
      designing: {
        run() {
          return {
            kind: "artifact-commit-request",
            artifacts: [{ kind: "design", content: "# Design\n", summary: "draft" }],
            metadata: { source: "test" },
          };
        },
      },
    },
  });

  const state = await runtime.startWorkflow("my-topic", "Build", "openai/test");
  assert.equal(state.phase, "awaiting-design-review-decision");
  assert.equal(state.artifacts.design?.kind, "design");
  assert.equal(state.artifacts.design?.version, 1);
  assert.equal(state.artifacts.design?.checksum, checksum("# Design\n"));
  assert.equal(await fs.readFile(path.join(cwd, "specs", "my-topic", "design.md"), "utf8"), "# Design\n");

  const events = await readWorkflowEvents(await createWorkflowLayout(cwd, "my-topic"));
  assert.deepEqual(events.map((event) => event.type), ["artifact.created", "phase.completed"]);
});

test("adapter blocked results do not commit or advance", async () => {
  const cwd = await tempProject();
  const runtime = new WorkflowRuntimeOrchestrator(cwd, {
    adapters: {
      designing: {
        run() {
          return { kind: "blocked", reason: "missing precondition", diagnostics: { code: "test" } };
        },
      },
    },
  });

  const state = await runtime.startWorkflow("my-topic", "Build", "openai/test");
  assert.equal(state.phase, "blocked");
  assert.equal(state.lastError?.message, "missing precondition");
  await assert.rejects(fs.readFile(path.join(cwd, "specs", "my-topic", "design.md"), "utf8"), /ENOENT/u);
});

test("adapter failed results do not commit and preserve retryability", async () => {
  const cwd = await tempProject();
  const runtime = new WorkflowRuntimeOrchestrator(cwd, {
    adapters: {
      designing: {
        run() {
          return { kind: "failed", error: { kind: "invalid-output", message: "bad json", retryable: false } };
        },
      },
    },
  });

  const state = await runtime.startWorkflow("my-topic", "Build", "openai/test");
  assert.equal(state.phase, "failed");
  assert.equal(state.lastError?.recoverable, false);
  assert.equal(state.lastError?.message, "bad json");
  await assert.rejects(fs.readFile(path.join(cwd, "specs", "my-topic", "design.md"), "utf8"), /ENOENT/u);
});
