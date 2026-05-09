import assert from "node:assert/strict";
import test from "node:test";
import clarificationOrchestrator from "../../extensions/clarification-orchestrator/index.ts";

test("child mode skips brainstorm-pro command registration", () => {
  const previous = process.env.BRAINSTORMING_PRO_CHILD;
  process.env.BRAINSTORMING_PRO_CHILD = "1";
  try {
    const registered: string[] = [];
    clarificationOrchestrator({
      registerCommand(name: string) {
        registered.push(name);
      },
    } as any);
    assert.deepEqual(registered, []);
  } finally {
    if (previous === undefined) delete process.env.BRAINSTORMING_PRO_CHILD;
    else process.env.BRAINSTORMING_PRO_CHILD = previous;
  }
});

test("parent mode still registers brainstorm-pro command", () => {
  const previous = process.env.BRAINSTORMING_PRO_CHILD;
  delete process.env.BRAINSTORMING_PRO_CHILD;
  try {
    const registered: string[] = [];
    clarificationOrchestrator({
      registerCommand(name: string) {
        registered.push(name);
      },
    } as any);
    assert.deepEqual(registered, ["brainstorm-pro"]);
  } finally {
    if (previous === undefined) delete process.env.BRAINSTORMING_PRO_CHILD;
    else process.env.BRAINSTORMING_PRO_CHILD = previous;
  }
});
