import test from "node:test";
import assert from "node:assert/strict";
import { buildSingleTaskPrompt } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec/prompts.ts";
import { parseTaskPlan } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec/task-plan-parser.ts";
import type { SpecExecAdapterContext } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec/context.ts";

const plan = parseTaskPlan(`## Tasks\n- [✅] 1. Done\n  - _Requirements: 1.1_\n- [ ] 2. Checkpoint - Verify\n  - Validate done work\n  - _Requirements: 2.1_\n- [ ] 3. Later\n  - _Requirements: 3.1_\n`);
const task = plan.tasks.find((entry) => entry.id === "2");
if (!task) throw new Error("missing test task");

test("scopes prompt to one current task and acceptance truth", () => {
  const prompt = buildSingleTaskPrompt(context(), plan, task, "full");
  assert.match(prompt, /executing exactly one selected task/u);
  assert.match(prompt, /Current task only:[\s\S]*id: 2/u);
  assert.match(prompt, /Requirements acceptance source of truth/u);
  assert.match(prompt, /Background design context only/u);
  assert.match(prompt, /Do not execute later tasks/u);
  assert.match(prompt, /Do not update tasks.md checkboxes/u);
  assert.match(prompt, /Do not modify approved requirements.md/u);
  assert.match(prompt, /Do not modify approved design.md/u);
  assert.match(prompt, /not a user approval gate/u);
});

function context(): SpecExecAdapterContext {
  return {
    topic: "my-topic",
    runId: "run-1",
    projectRoot: "/tmp/project",
    topicDir: "/tmp/project/specs/my-topic",
    workflowDir: "/tmp/project/specs/my-topic/.workflow",
    layout: {
      topic: "my-topic",
      topicDir: "/tmp/project/specs/my-topic",
      workflowDir: "/tmp/project/specs/my-topic/.workflow",
      artifactsDir: "/tmp/project/specs/my-topic/.workflow/artifacts",
      decisionsDir: "/tmp/project/specs/my-topic/.workflow/decisions",
      approvalsDir: "/tmp/project/specs/my-topic/.workflow/approvals",
      eventsPath: "/tmp/project/specs/my-topic/.workflow/events.jsonl",
    },
    approvedRequirements: { content: "# Requirements", absolutePath: "/tmp/project/specs/my-topic/.workflow/artifacts/requirements/v1.md", ref: { kind: "requirements", version: 1, path: ".workflow/artifacts/requirements/v1.md", checksum: "abc", createdAt: "now" } },
    approvedTasks: { content: "## Tasks", absolutePath: "/tmp/project/specs/my-topic/.workflow/artifacts/tasks/v1.md", ref: { kind: "tasks", version: 1, path: ".workflow/artifacts/tasks/v1.md", checksum: "abc", createdAt: "now" } },
    approvedDesign: { content: "# Design", absolutePath: "/tmp/project/specs/my-topic/.workflow/artifacts/design/v1.md", ref: { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "abc", createdAt: "now" } },
    planApproval: { gate: "plan", artifacts: [], approvedBy: "tester", approvedAt: "now", path: ".workflow/approvals/plan.json" },
    state: { version: 1, runId: "run-1", topic: "my-topic", request: "Build", phase: "executing", createdAt: "now", updatedAt: "now", artifacts: {}, reviewDecisions: {}, reviewStatus: {}, gates: {} },
  };
}
