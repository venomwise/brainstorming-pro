import test from "node:test";
import assert from "node:assert/strict";
import { buildBrainstormingPrompt } from "../../../extensions/clarification-orchestrator/workflow/adapters/prompts/brainstorming.ts";
import { buildSpecPlanPrompt } from "../../../extensions/clarification-orchestrator/workflow/adapters/prompts/spec-plan.ts";
import type { BrainstormingAdapterContext, SpecPlanAdapterContext } from "../../../extensions/clarification-orchestrator/workflow/adapters/context.ts";
import { createInitialWorkflowState } from "../../../extensions/clarification-orchestrator/workflow/runtime.ts";
import type { VersionedArtifactRef } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

const state = createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" });

test("brainstorming prompt contains required constraints", () => {
  const context: BrainstormingAdapterContext = { topic: "my-topic", runId: "run-1", request: "Build", projectRoot: "/repo", topicDir: "/repo/specs/my-topic", workflow: state };
  const prompt = buildBrainstormingPrompt(context);
  assert.match(prompt.systemPrompt, /design-author/u);
  assert.match(prompt.prompt, /## Proposed Solution/u);
  assert.match(prompt.prompt, /requirements\.md/u);
  assert.match(prompt.prompt, /Do not approve/u);
  assert.match(prompt.prompt, /design-draft/u);
});

test("spec-plan prompt contains approved design metadata and constraints", () => {
  const ref: VersionedArtifactRef = { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "abc", createdAt: "now" };
  const context: SpecPlanAdapterContext = {
    topic: "my-topic",
    runId: "run-1",
    projectRoot: "/repo",
    topicDir: "/repo/specs/my-topic",
    workflow: state,
    approvedDesign: { ref, content: "## Summary\nDesign" },
    designApproval: { gate: "design", artifacts: [ref], approvedBy: "u", approvedAt: "now", path: ".workflow/approvals/design-approval.json" },
  };
  const prompt = buildSpecPlanPrompt(context);
  assert.match(prompt.systemPrompt, /plan-author/u);
  assert.match(prompt.prompt, /version=1/u);
  assert.match(prompt.prompt, /checksum=abc/u);
  assert.match(prompt.prompt, /approvedBy=u/u);
  assert.match(prompt.prompt, /Do not execute tasks/u);
  assert.match(prompt.prompt, /unchecked checkbox/u);
  assert.match(prompt.prompt, /plan-draft/u);
});
