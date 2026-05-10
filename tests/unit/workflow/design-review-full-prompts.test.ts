import assert from "node:assert/strict";
import test from "node:test";
import { resolveFullDesignReviewerSet } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/full-reviewer-registry.ts";
import type { VersionedArtifactRef } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

const designRef: VersionedArtifactRef = {
  kind: "design",
  version: 7,
  path: ".workflow/artifacts/design/v7.md",
  checksum: "sha256:abc",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const expectedFocus = new Map([
  ["product-reviewer", ["problem statement", "users", "success criteria", "non-goals", "planning"]],
  ["architecture-reviewer", ["component boundaries", "runtime ownership", "interfaces", "data flow", "maintainability"]],
  ["risk-security-reviewer", ["path traversal", "topic scoping", "checksum", "approval gate", "fail-closed", "audit"]],
  ["testing-reviewer", ["unit", "integration", "security", "documentation", "negative paths", "fixtures", "evidence"]],
  ["scope-simplicity-reviewer", ["YAGNI", "over-abstraction", "future specs", "spec boundary", "maintainability"]],
]);

test("full reviewer prompts are role-specific, artifact-bound, structured, and read-only", () => {
  for (const definition of resolveFullDesignReviewerSet()) {
    const prompt = definition.buildPrompt({ topic: "my-topic", designRef, designContent: "# Design\ncontent" });
    const systemPrompt = definition.buildSystemPrompt();
    assert.match(prompt, /Exact design artifact metadata/u);
    assert.match(prompt, /"version": 7/u);
    assert.match(prompt, /sha256:abc/u);
    assert.match(prompt, /# Design\ncontent/u);
    assert.match(prompt, /Return JSON exactly matching/u);
    assert.match(systemPrompt, /structured JSON findings only/u);
    for (const text of [prompt, systemPrompt]) {
      assert.match(text, /never approve|Never edit artifacts/u);
      assert.match(text, /workflow state/u);
      assert.match(text, /gate skipping/u);
    }
    for (const token of expectedFocus.get(definition.role) ?? []) {
      assert.match(`${prompt}\n${systemPrompt}`, new RegExp(token, "iu"));
    }
  }
});
