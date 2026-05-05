import test from "node:test";
import assert from "node:assert/strict";
import { detectSecuritySensitiveChanges, requiresUserConfirmation } from "../../extensions/clarification-orchestrator/config.ts";
import { detectToolExpansion } from "../../extensions/clarification-orchestrator/agents.ts";
import type { AgentDefinition } from "../../extensions/clarification-orchestrator/types.ts";

test("project-local config and tool expansion require confirmation", () => {
  const changes = detectSecuritySensitiveChanges({ security: { allowProjectAgents: true, allowProjectToolExpansion: true, debugArtifacts: "enabled" } } as any, "project-config");
  assert.equal(requiresUserConfirmation(changes), true);
  const agent: AgentDefinition = { name: "reviewer-product", role: "reviewer", description: "", path: "", source: "project", tools: [], prompt: "" };
  assert.deepEqual(detectToolExpansion(agent, ["read", "bash"]), ["bash"]);
});
