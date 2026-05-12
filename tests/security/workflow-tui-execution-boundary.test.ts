import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { WorkflowLiveWidget, renderExpandedWorkflowSnapshot } from "../../extensions/clarification-orchestrator/tui/workflow-widget.ts";
import type { WorkflowLiveSnapshot } from "../../extensions/clarification-orchestrator/workflow/progress-types.ts";

function executionSnapshot(): WorkflowLiveSnapshot {
  return {
    topic: "live-progress",
    runId: "run-1",
    phase: "executing",
    phaseStatus: "running",
    version: 1,
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:10.000Z",
    stale: false,
    fallbackText: "Executing tasks.",
    timeline: [],
    artifacts: [],
    agents: [],
    reviewers: [],
    tasks: [{ taskId: "1.1", title: "Implement task", status: "running", activity: "editing", evidencePath: "evidence.log" }],
    gates: [],
    diagnostics: [],
  };
}

test("task rendering is observational and exposes no execution controls", () => {
  const output = renderExpandedWorkflowSnapshot(executionSnapshot(), 100).join("\n");
  assert.match(output, /Task/);
  assert.doesNotMatch(output, /select task|write checkbox|mark complete|validate evidence|advance execution|run task/iu);
});

test("widget input cannot choose tasks or mutate execution state", () => {
  const widget = new WorkflowLiveWidget({ getSnapshot: executionSnapshot });
  assert.equal(widget.handleInput("1.1"), "ignored");
  assert.equal(widget.handleInput("mark complete"), "ignored");
  assert.equal(widget.handleInput("validate"), "ignored");
});

test("TUI widget source does not import execution checkbox writers or validators", async () => {
  const content = await readFile(path.join(process.cwd(), "extensions/clarification-orchestrator/tui/workflow-widget.ts"), "utf8");
  assert.doesNotMatch(content, /checkbox-writer|markTaskComplete|runExecutionLoop|verifyNoUnauthorizedArtifactMutation/u);
});
