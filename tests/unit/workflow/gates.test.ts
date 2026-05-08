import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { approveGate, recordReviewDecision, validateReviewDecision } from "../../../extensions/clarification-orchestrator/workflow/gates.ts";

async function tempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bp-workflow-gates-"));
}

test("records review decisions and approvals for exact artifact refs", async () => {
  const layout = await createWorkflowLayout(await tempProject(), "my-topic");
  const design = await writeVersionedArtifact(layout, "design", "# design");
  const decision = await recordReviewDecision(layout, { target: "design", mode: "skip", artifacts: [design], selectedBy: "tester" });
  assert.equal(decision.mode, "skip");
  const approval = await approveGate(layout, { gate: "design", artifacts: [design], approvedBy: "tester" });
  assert.equal(approval.gate, "design");
});

test("rejects stale or mismatched artifact refs", async () => {
  const layout = await createWorkflowLayout(await tempProject(), "my-topic");
  const design = await writeVersionedArtifact(layout, "design", "# design");
  await fs.writeFile(path.join(layout.topicDir, design.path), "tampered");
  await assert.rejects(() => validateReviewDecision(layout, { artifacts: [design] }), /checksum mismatch/);
});
