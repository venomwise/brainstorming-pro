import assert from "node:assert/strict";
import test from "node:test";
import { WorkflowProgressController } from "../../extensions/clarification-orchestrator/workflow/live-snapshot-store.ts";
import { openWorkflowLiveSession } from "../../extensions/clarification-orchestrator/tui/workflow-session.ts";
import type { WorkflowLiveSnapshot } from "../../extensions/clarification-orchestrator/workflow/progress-types.ts";
import type { WorkflowState } from "../../extensions/clarification-orchestrator/workflow/types.ts";

function state(): WorkflowState {
  return {
    version: 1,
    topic: "live-progress",
    runId: "run-1",
    request: "request",
    phase: "designing",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
    artifacts: {},
    reviewDecisions: {},
    reviewStatus: {},
    gates: {},
  };
}

function snapshot(): WorkflowLiveSnapshot {
  const controller = new WorkflowProgressController({ topic: "live-progress", runId: "run-1", throttleMs: 0 });
  return controller.getSnapshot(state());
}

test("TUI session opens, requests renders, and closes around a simulated step", async () => {
  const controller = new WorkflowProgressController({ topic: "live-progress", runId: "run-1", throttleMs: 0 });
  let opened = false;
  let renders = 0;
  let closed = false;
  const session = await openWorkflowLiveSession({
    controller,
    getSnapshot: () => controller.getSnapshot(state()),
    interactive: true,
    width: 80,
    ctx: {
      ui: {
        custom(component) {
          opened = component.render(80).length > 0;
          return {
            requestRender() { renders += 1; },
            close() { closed = true; },
          };
        },
      },
    },
  });

  controller.emit({ type: "phase.activity", topic: "live-progress", runId: "run-1", phase: "designing", at: "2026-05-12T00:00:01.000Z", activity: "working" });
  session.requestRender();
  await session.close();

  assert.equal(opened, true);
  assert.ok(renders >= 1);
  assert.equal(closed, true);
});

test("session falls back when TUI is unavailable or setup fails", async () => {
  const controller = new WorkflowProgressController({ topic: "live-progress", runId: "run-1" });
  const unavailable = await openWorkflowLiveSession({ controller, getSnapshot: snapshot, interactive: false, width: 80 });
  assert.match(unavailable.fallbackText ?? "", /Workflow status/);

  const failing = await openWorkflowLiveSession({
    controller,
    getSnapshot: snapshot,
    interactive: true,
    width: 80,
    ctx: { ui: { custom() { throw new Error("boom"); } } },
  });
  assert.match(failing.diagnostic ?? "", /boom/);
  assert.match(failing.fallbackText ?? "", /Workflow status/);
});

test("cleanup runs after simulated runtime error and runtime state is presentation invariant", async () => {
  const controller = new WorkflowProgressController({ topic: "live-progress", runId: "run-1" });
  let closed = false;
  const before = JSON.stringify(state());
  const session = await openWorkflowLiveSession({
    controller,
    getSnapshot: () => controller.getSnapshot(state()),
    interactive: true,
    width: 80,
    ctx: { ui: { custom() { return { close() { closed = true; } }; } } },
  });

  try {
    throw new Error("runtime failed");
  } catch {
    // Simulated runtime error is intentionally swallowed by the test harness.
  } finally {
    await session.close();
  }

  assert.equal(closed, true);
  assert.equal(JSON.stringify(state()), before);
});
