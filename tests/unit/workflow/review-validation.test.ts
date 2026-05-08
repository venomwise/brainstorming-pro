import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { validateReviewReadiness } from "../../../extensions/clarification-orchestrator/workflow/review-validation.ts";

async function tempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bp-workflow-review-"));
}

test("passes for existing non-empty matching artifacts", async () => {
  const layout = await createWorkflowLayout(await tempProject(), "my-topic");
  const design = await writeVersionedArtifact(layout, "design", "# design");
  const result = await validateReviewReadiness(layout, "design", [design]);
  assert.equal(result.status, "passed");
});

test("blocks for missing artifacts and fails for checksum mismatch", async () => {
  const layout = await createWorkflowLayout(await tempProject(), "my-topic");
  const design = await writeVersionedArtifact(layout, "design", "# design");
  await fs.rm(path.join(layout.topicDir, design.path));
  assert.equal((await validateReviewReadiness(layout, "design", [design])).status, "blocked");
  const other = await writeVersionedArtifact(layout, "design", "# other");
  await fs.writeFile(path.join(layout.topicDir, other.path), "tampered");
  assert.equal((await validateReviewReadiness(layout, "design", [other])).status, "failed");
});
