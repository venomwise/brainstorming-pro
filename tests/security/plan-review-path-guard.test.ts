import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { bindPlanReviewArtifacts } from "../../extensions/clarification-orchestrator/workflow/adapters/plan-review/artifact-binding.ts";
import { createWorkflowLayout, writeVersionedArtifact } from "../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import type { WorkflowState } from "../../extensions/clarification-orchestrator/workflow/types.ts";

test("plan review binding rejects external artifact paths", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-plan-path-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const design = await writeVersionedArtifact(layout, "design", "d");
  const requirements = await writeVersionedArtifact(layout, "requirements", "r");
  const tasks = await writeVersionedArtifact(layout, "tasks", "t");
  const result = await bindPlanReviewArtifacts(layout, { artifacts: { design, requirements: { ...requirements, path: "/tmp/escape" }, tasks }, gates: { design: { artifacts: [design] } } } as WorkflowState);
  assert.equal(result.ok, false);
});
