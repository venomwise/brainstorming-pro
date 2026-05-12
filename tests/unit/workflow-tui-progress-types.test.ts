import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyWorkflowProgressEvent,
  isWorkflowProgressEventForRun,
  progressEventKey,
  progressEventTimestamp,
  type WorkflowLiveSnapshot,
  type WorkflowProgressEvent,
} from "../../extensions/clarification-orchestrator/workflow/progress-types.ts";

const phaseEvent: WorkflowProgressEvent = {
  type: "phase.activity",
  topic: "live-progress",
  runId: "run-1",
  phase: "designing",
  at: "2026-05-12T00:00:00.000Z",
  activity: "drafting design",
};

test("workflow progress event identity helpers accept only matching topic and run", () => {
  assert.equal(isWorkflowProgressEventForRun(phaseEvent, "live-progress", "run-1"), true);
  assert.equal(isWorkflowProgressEventForRun(phaseEvent, "other-topic", "run-1"), false);
  assert.equal(isWorkflowProgressEventForRun(phaseEvent, "live-progress", "run-2"), false);
});

test("workflow progress event classification reports malformed identity", () => {
  assert.deepEqual(classifyWorkflowProgressEvent(null), { valid: false, reason: "not-object" });
  assert.deepEqual(classifyWorkflowProgressEvent({ topic: "t", runId: "r", phase: "designing", at: "now" }), {
    valid: false,
    reason: "missing-type",
  });
  assert.deepEqual(classifyWorkflowProgressEvent({ type: "phase.activity", runId: "r", phase: "designing", at: "now" }), {
    valid: false,
    reason: "missing-topic",
  });
  assert.deepEqual(classifyWorkflowProgressEvent({ type: "phase.activity", topic: "t", phase: "designing", at: "now" }), {
    valid: false,
    reason: "missing-run-id",
  });
  assert.deepEqual(classifyWorkflowProgressEvent({ type: "phase.activity", topic: "t", runId: "r", at: "now" }), {
    valid: false,
    reason: "missing-phase",
  });
  assert.deepEqual(classifyWorkflowProgressEvent({ type: "phase.activity", topic: "t", runId: "r", phase: "designing" }), {
    valid: false,
    reason: "missing-timestamp",
  });
});

test("workflow progress event timestamp and key are stable", () => {
  assert.equal(progressEventTimestamp(phaseEvent), "2026-05-12T00:00:00.000Z");
  assert.equal(
    progressEventKey(phaseEvent),
    "live-progress:run-1:designing:phase.activity:running:2026-05-12T00:00:00.000Z",
  );

  const reviewerEvent: WorkflowProgressEvent = {
    type: "reviewer.progress",
    topic: "live-progress",
    runId: "run-1",
    phase: "design-review",
    at: "2026-05-12T00:01:00.000Z",
    reviewRunId: "review-1",
    target: "design",
    reviewerId: "product-reviewer",
    status: "passed",
    findingCount: 0,
  };
  assert.equal(
    progressEventKey(reviewerEvent),
    "live-progress:run-1:design-review:reviewer.progress:review-1:product-reviewer:passed:2026-05-12T00:01:00.000Z",
  );
});

test("workflow live snapshot shape carries typed presentation arrays", () => {
  const snapshot: WorkflowLiveSnapshot = {
    topic: "live-progress",
    runId: "run-1",
    phase: "awaiting-design-approval",
    phaseStatus: "awaiting-user",
    version: 1,
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:01:00.000Z",
    stale: false,
    fallbackText: "Workflow live-progress is awaiting design approval.",
    timeline: [{ phase: "designing", status: "completed", completedAt: "2026-05-12T00:01:00.000Z" }],
    currentActivity: {
      id: "gate:design",
      kind: "phase",
      label: "Awaiting design approval",
      status: "awaiting-user",
      updatedAt: "2026-05-12T00:01:00.000Z",
    },
    artifacts: [
      {
        kind: "design",
        version: 1,
        path: "specs/live-progress/design.md",
        checksum: "abcdef123456",
        createdAt: "2026-05-12T00:00:30.000Z",
      },
    ],
    agents: [],
    reviewers: [],
    tasks: [],
    gates: [
      {
        id: "design-approval",
        gate: "design-approval",
        title: "Design approval required",
        status: "awaiting-user",
        artifacts: [],
        safeCommands: ["/brainstorm-pro --resume live-progress"],
      },
    ],
    diagnostics: [],
  };

  assert.equal(snapshot.topic, "live-progress");
  assert.equal(snapshot.gates[0]?.gate, "design-approval");
  assert.equal(snapshot.artifacts[0]?.kind, "design");
});
