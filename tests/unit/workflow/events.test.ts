import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowLayout } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { appendWorkflowEvent, readWorkflowEvents } from "../../../extensions/clarification-orchestrator/workflow/events.ts";

async function tempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bp-workflow-events-"));
}

test("appends and reads workflow events", async () => {
  const layout = await createWorkflowLayout(await tempProject(), "my-topic");
  await appendWorkflowEvent(layout, { type: "workflow.started", phase: "designing" });
  await appendWorkflowEvent(layout, { type: "workflow.phase.changed", phase: "awaiting-design-review-decision" });
  const events = await readWorkflowEvents(layout);
  assert.equal(events.length, 2);
  assert.equal(events[0]?.type, "workflow.started");
  assert.equal(events[1]?.phase, "awaiting-design-review-decision");
});
