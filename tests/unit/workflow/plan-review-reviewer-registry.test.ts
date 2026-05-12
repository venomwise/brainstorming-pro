import assert from "node:assert/strict";
import test from "node:test";
import { getFixedPlanReviewers, isPlanReviewerRole } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/reviewer-registry.ts";
import { buildPlanReviewerPrompt } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/prompts/shared.ts";
import type { PlanReviewArtifactBinding } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/types.ts";

const ref = { kind: "design" as const, version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "abc", createdAt: "2026-01-01T00:00:00.000Z" };
const binding: PlanReviewArtifactBinding = { design: ref, approvedDesignRef: ref, requirements: { ...ref, kind: "requirements", path: ".workflow/artifacts/requirements/v1.md" }, tasks: { ...ref, kind: "tasks", path: ".workflow/artifacts/tasks/v1.md" }, createdAt: ref.createdAt };

test("getFixedPlanReviewers returns exactly the fixed Spec 6 role set and ignores inputs", () => {
  assert.deepEqual(getFixedPlanReviewers({ requested: ["other"] }), ["requirements-coverage-reviewer", "task-coverage-reviewer", "dependency-order-reviewer"]);
  assert.equal(isPlanReviewerRole("task-coverage-reviewer"), true);
  assert.equal(isPlanReviewerRole("product-reviewer"), false);
});

test("plan reviewer prompts include binding, read-only policy, and role focus", () => {
  for (const role of getFixedPlanReviewers()) {
    const prompt = buildPlanReviewerPrompt({ role, binding, contents: { design: "# Design", requirements: "# Requirements", tasks: "# Tasks" } });
    assert.match(prompt.systemPrompt, /read-only/u);
    assert.match(prompt.prompt, new RegExp(role, "u"));
    assert.match(prompt.prompt, /checksum/u);
    assert.match(prompt.prompt, /Do not include approval, execution, artifact mutation/u);
  }
});
