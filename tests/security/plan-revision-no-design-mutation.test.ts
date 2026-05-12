import assert from "node:assert/strict";
import test from "node:test";
import { validatePlanRevisionAgentOutput } from "../../extensions/clarification-orchestrator/workflow/adapters/plan-review/schemas.ts";

test("plan reviser cannot mutate design or task execution progress", () => {
  assert.throws(() => validatePlanRevisionAgentOutput({ status: "revised", revisedRequirements: "r", revisedTasks: "t", addressedFindingIds: [], unresolvedFindingIds: [], summary: "x", requiresDesignRevision: false, design: "new design" }), /unauthorized|object/u);
  assert.throws(() => validatePlanRevisionAgentOutput({ status: "revised", revisedRequirements: "r", revisedTasks: "- [x] 1. Done", addressedFindingIds: [], unresolvedFindingIds: [], summary: "x", requiresDesignRevision: false }), /must not mark task execution/u);
});
