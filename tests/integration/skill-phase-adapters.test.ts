import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowRuntimeOrchestrator } from "../../extensions/clarification-orchestrator/workflow/runtime.ts";
import type { AdapterPhaseResult } from "../../extensions/clarification-orchestrator/workflow/adapters/types.ts";

async function tempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bp-skill-adapters-int-"));
}

const designMarkdown = `# Design

## Summary
x
## Goals
x
## Primary Users / Roles
x
## Non-Goals
x
## Context
x
## Proposed Solution
x
## Error Handling
x
## Testing
x
## Open Questions
x
`;

const tasksMarkdown = `# Implementation Plan

## Overview
x

## Tasks

- [ ] 1. Phase 1: Build
  - [ ] 1.1 Implement
    - _Requirements: 1.1_
`;

test("runtime commits generated design then generated plan and stops at gates", async () => {
  const cwd = await tempProject();
  const runtime = new WorkflowRuntimeOrchestrator(cwd, {
    adapters: {
      designing: { run: () => ({ kind: "artifact-commit-request", artifacts: [{ kind: "design", content: designMarkdown }] }) },
      planning: { run: () => ({ kind: "artifact-commit-request", artifacts: [{ kind: "requirements", content: "# Requirements\n" }, { kind: "tasks", content: tasksMarkdown }] }) },
    },
  });
  const designed = await runtime.startWorkflow("my-topic", "Build");
  assert.equal(designed.phase, "awaiting-design-review-decision");
  assert.equal(await fs.readFile(path.join(cwd, "specs", "my-topic", "design.md"), "utf8"), designMarkdown);

  await runtime.resumeWorkflow("my-topic", { type: "review-mode", mode: "skip", user: "u" });
  const planning = await runtime.resumeWorkflow("my-topic", { type: "approval", action: "approve", user: "u" });
  assert.equal("phase" in planning && planning.phase, "awaiting-plan-review-decision");
  assert.equal(await fs.readFile(path.join(cwd, "specs", "my-topic", "requirements.md"), "utf8"), "# Requirements\n");
  assert.equal(await fs.readFile(path.join(cwd, "specs", "my-topic", "tasks.md"), "utf8"), tasksMarkdown);
});

test("runtime fails closed for malformed adapter output", async () => {
  const cwd = await tempProject();
  const runtime = new WorkflowRuntimeOrchestrator(cwd, {
    adapters: {
      designing: { run: () => ({ kind: "failed", error: { kind: "schema-validation-failed", message: "bad output", retryable: false } } satisfies AdapterPhaseResult) },
    },
  });
  const state = await runtime.startWorkflow("my-topic", "Build");
  assert.equal(state.phase, "failed");
  await assert.rejects(fs.readFile(path.join(cwd, "specs", "my-topic", "design.md"), "utf8"), /ENOENT/u);
});
