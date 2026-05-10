import test from "node:test";
import assert from "node:assert/strict";
import { validateSingleTaskExecutionResult } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec/schemas.ts";
import type { ParsedTask } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec/task-plan-parser.ts";

const task: ParsedTask = {
  id: "1.1",
  title: "Implement",
  kind: "task",
  optional: false,
  optionalInherited: false,
  completed: false,
  parentId: "1",
  requirementIds: ["1.1"],
  descriptionLines: ["    - _Requirements: 1.1_"],
  originalLine: "  - [ ] 1.1 Implement",
  lineNumber: 2,
  indent: 2,
  children: [],
};

test("accepts valid completed, blocked, and failed results", () => {
  assert.equal(validateSingleTaskExecutionResult(baseResult(), task).status, "completed");
  assert.equal(validateSingleTaskExecutionResult({ ...baseResult(), status: "blocked", blocker: blocker(), validation: { commands: [], evidence: [] } }, task).status, "blocked");
  assert.equal(validateSingleTaskExecutionResult({ ...baseResult(), status: "failed", error: { kind: "boom", message: "Nope", retryable: false }, validation: { commands: [], evidence: [] } }, task).status, "failed");
});

test("rejects mismatched task id, missing evidence, and status-specific omissions", () => {
  assert.throws(() => validateSingleTaskExecutionResult({ ...baseResult(), taskId: "2.1" }, task), /taskId/u);
  assert.throws(() => validateSingleTaskExecutionResult({ ...baseResult(), validation: { commands: [], evidence: [] } }, task), /evidence/u);
  assert.throws(() => validateSingleTaskExecutionResult({ ...baseResult(), status: "blocked" }, task), /blocker/u);
  assert.throws(() => validateSingleTaskExecutionResult({ ...baseResult(), status: "failed" }, task), /error/u);
});

test("rejects unsafe changed files", () => {
  for (const changedFiles of [["/tmp/file"], ["../escape.ts"], ["specs/my-topic/tasks.md"], ["specs/my-topic/requirements.md"], ["specs/my-topic/design.md"]]) {
    assert.throws(() => validateSingleTaskExecutionResult({ ...baseResult(), changedFiles }, task), /changedFiles/u);
  }
});

function baseResult(): Record<string, unknown> {
  return {
    kind: "single-task-result",
    taskId: "1.1",
    status: "completed",
    changedFiles: ["src/file.ts"],
    summary: "Done",
    validation: { commands: [{ command: "npm test", status: "passed", summary: "ok" }], evidence: ["Tests passed"] },
  };
}

function blocker(): Record<string, unknown> {
  return {
    task: "1.1 Implement",
    type: "missing_dependency",
    context: { taskExcerpt: "task", requirements: "req" },
    tried: ["checked"],
    risk: "cannot proceed",
    options: ["provide dependency"],
    neededFromUser: "dependency",
  };
}
