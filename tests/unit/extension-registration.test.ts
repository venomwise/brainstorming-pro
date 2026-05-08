import test from "node:test";
import assert from "node:assert/strict";
import clarificationOrchestrator from "../../extensions/clarification-orchestrator/index.ts";

test("clarification orchestrator registers only the workflow runtime command", () => {
  const registered: string[] = [];
  const pi = {
    registerCommand(name: string) {
      registered.push(name);
    },
  } as any;

  clarificationOrchestrator(pi);

  assert.deepEqual(registered, ["brainstorm-pro"]);
});
