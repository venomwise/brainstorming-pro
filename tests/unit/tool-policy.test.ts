import test from "node:test";
import assert from "node:assert/strict";
import { defaultToolsForRole, detectToolExpansion } from "../../extensions/clarification-orchestrator/agents.ts";
import type { AgentDefinition } from "../../extensions/clarification-orchestrator/types.ts";

test("defaultToolsForRole returns expected readonly sets", () => {
  assert.deepEqual(defaultToolsForRole("triager", "triager"), []);
  assert.deepEqual(defaultToolsForRole("refiner", "refiner"), ["read"]);
  assert.deepEqual(defaultToolsForRole("reviewer", "reviewer-product"), ["read", "find", "grep", "ls"]);
});

test("detectToolExpansion reports non-default tools", () => {
  const agent: AgentDefinition = {
    name: "reviewer-product",
    role: "reviewer",
    description: "",
    path: "",
    source: "bundled",
    tools: ["read"],
    prompt: "",
  };
  assert.deepEqual(detectToolExpansion(agent, ["read", "find", "grep", "ls", "bash"]), ["bash"]);
});
