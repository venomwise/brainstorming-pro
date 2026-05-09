import test from "node:test";
import assert from "node:assert/strict";
import { specExecAdapter } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec.ts";
import { createInitialWorkflowState } from "../../../extensions/clarification-orchestrator/workflow/runtime.ts";

test("spec-exec adapter remains blocked and does not mark done", async () => {
  const state = { ...createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" }), phase: "executing" as const };
  const result = await specExecAdapter.run(state, state);
  assert.equal(result.kind, "blocked");
  assert.match(result.kind === "blocked" ? result.reason : "", /controlled-spec-exec-adapter-unavailable/u);
  assert.notEqual(result.kind, "artifact-commit-request");
});

test("spec-exec adapter documents single-task future contract", async () => {
  const state = { ...createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" }), phase: "executing" as const };
  const result = await specExecAdapter.run(state, state);
  assert.equal(result.kind === "blocked" && typeof result.diagnostics?.futureContract, "object");
  assert.match(JSON.stringify(result.kind === "blocked" && result.diagnostics), /single-task worker/u);
  assert.match(JSON.stringify(result.kind === "blocked" && result.diagnostics), /must not update tasks.md/u);
});
