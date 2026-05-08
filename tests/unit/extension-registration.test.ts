import test from "node:test";
import assert from "node:assert/strict";
import clarificationOrchestrator from "../../extensions/clarification-orchestrator/index.ts";

test("clarification orchestrator registers only focused public commands", () => {
  const registered: string[] = [];
  const pi = {
    registerCommand(name: string) {
      registered.push(name);
    },
  } as any;

  clarificationOrchestrator(pi);

  assert.deepEqual(registered, ["brainstorm-pro", "clarify", "clarify-status", "spec-plan", "spec-exec", "clarify-doctor"]);
  assert.equal(registered.includes("clarify-diff"), false);
  assert.equal(registered.includes("clarify-clean"), false);
});
