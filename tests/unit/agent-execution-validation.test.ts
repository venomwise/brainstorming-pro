import assert from "node:assert/strict";
import test from "node:test";
import { agentCompleted, agentFailed, agentOutput, agentRetrying, agentStarted, emitAgentProgress } from "../../extensions/clarification-orchestrator/runtime/agent-execution/progress.ts";
import { validateAgentOutput } from "../../extensions/clarification-orchestrator/runtime/agent-execution/result-validation.ts";
import { createAgentRunError, type AgentOutputSchema } from "../../extensions/clarification-orchestrator/runtime/agent-execution/types.ts";

type SampleOutput = { status: "ok"; value: string };

const schema: AgentOutputSchema<SampleOutput> = {
  name: "sample",
  parse(raw) {
    return JSON.parse(raw) as unknown;
  },
  validate(value) {
    if (!value || typeof value !== "object") throw new Error("not an object");
    const record = value as Record<string, unknown>;
    if (record.status !== "ok" || typeof record.value !== "string") throw new Error("invalid sample output");
    return { status: "ok", value: record.value };
  },
};

test("validateAgentOutput returns typed output for schema success", () => {
  const result = validateAgentOutput('{"status":"ok","value":"done"}', schema);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.output, { status: "ok", value: "done" });
});

test("validateAgentOutput returns invalid-output for malformed raw output", () => {
  const result = validateAgentOutput("not json", schema);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "invalid-output");
});

test("validateAgentOutput returns schema-validation-failed for schema mismatch", () => {
  const result = validateAgentOutput('{"status":"bad"}', schema);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "schema-validation-failed");
});

test("progress event helpers create expected events and callback failures are diagnostics-only", async () => {
  const error = createAgentRunError("non-zero-exit", "failed");
  const started = agentStarted("agent-1", "design-author");
  assert.equal(started.type, "agent.started");

  const output = agentOutput("agent-1", "stdout", 3);
  assert.equal(output.type, "agent.output");
  assert.equal(output.stream, "stdout");

  const retrying = agentRetrying("agent-1", 2, "timeout");
  assert.equal(retrying.type, "agent.retrying");
  assert.equal(retrying.attempt, 2);

  const completed = agentCompleted("agent-1", "succeeded");
  assert.equal(completed.type, "agent.completed");
  assert.equal(completed.status, "succeeded");

  const failed = agentFailed("agent-1", error);
  assert.equal(failed.type, "agent.failed");
  assert.equal(failed.error.kind, "non-zero-exit");

  const diagnostics: string[] = [];
  await emitAgentProgress(() => {
    throw new Error("ui stale");
  }, agentStarted("agent-1", "design-author"), diagnostics);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0], /progress callback failed/i);
});
