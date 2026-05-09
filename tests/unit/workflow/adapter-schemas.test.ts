import test from "node:test";
import assert from "node:assert/strict";
import { createDesignDraftOutputSchema, createPlanDraftOutputSchema } from "../../../extensions/clarification-orchestrator/workflow/adapters/schemas.ts";

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

test("valid design draft output is accepted", () => {
  const schema = createDesignDraftOutputSchema("my-topic");
  const output = schema.validate({ kind: "design-draft", topic: "my-topic", summary: "s", designMarkdown, assumptions: [], nonGoals: [], risks: [], openQuestions: [] });
  assert.equal(output.kind, "design-draft");
});

test("design draft rejects topic mismatch and missing headings", () => {
  const schema = createDesignDraftOutputSchema("my-topic");
  assert.throws(() => schema.validate({ kind: "design-draft", topic: "other", summary: "s", designMarkdown, assumptions: [], nonGoals: [], risks: [], openQuestions: [] }), /topic/u);
  assert.throws(() => schema.validate({ kind: "design-draft", topic: "my-topic", summary: "s", designMarkdown: "## Summary\nx", assumptions: [], nonGoals: [], risks: [], openQuestions: [] }), /missing required heading/u);
});

test("design draft rejects generated plan content and approval claims", () => {
  const schema = createDesignDraftOutputSchema("my-topic");
  assert.throws(() => schema.validate({ kind: "design-draft", topic: "my-topic", summary: "s", designMarkdown: `${designMarkdown}\n# Implementation Plan: X`, assumptions: [], nonGoals: [], risks: [], openQuestions: [] }), /tasks.md/u);
  assert.throws(() => schema.validate({ kind: "design-draft", topic: "my-topic", summary: "s", designMarkdown: `${designMarkdown}\napproval completed`, assumptions: [], nonGoals: [], risks: [], openQuestions: [] }), /approval/u);
});

test("valid plan draft output is accepted", () => {
  const schema = createPlanDraftOutputSchema("my-topic");
  const output = schema.validate({ kind: "plan-draft", topic: "my-topic", requirementsMarkdown: "# Requirements\n", tasksMarkdown, traceability: [{ requirementId: "1.1", taskIds: ["1.1"] }], assumptions: [], risks: [] });
  assert.equal(output.kind, "plan-draft");
});

test("plan draft rejects empty markdown, missing tasks section, and pre-completed tasks", () => {
  const schema = createPlanDraftOutputSchema("my-topic");
  assert.throws(() => schema.validate({ kind: "plan-draft", topic: "my-topic", requirementsMarkdown: "", tasksMarkdown, traceability: [], assumptions: [], risks: [] }), /requirementsMarkdown/u);
  assert.throws(() => schema.validate({ kind: "plan-draft", topic: "my-topic", requirementsMarkdown: "# R", tasksMarkdown: "# T", traceability: [], assumptions: [], risks: [] }), /## Tasks/u);
  assert.throws(() => schema.validate({ kind: "plan-draft", topic: "my-topic", requirementsMarkdown: "# R", tasksMarkdown: tasksMarkdown.replace("- [ ] 1. Phase", "- [x] 1. Phase"), traceability: [], assumptions: [], risks: [] }), /pre-completed/u);
});

test("plan draft rejects premature execution instructions", () => {
  const schema = createPlanDraftOutputSchema("my-topic");
  assert.throws(() => schema.validate({ kind: "plan-draft", topic: "my-topic", requirementsMarkdown: "# R", tasksMarkdown: `${tasksMarkdown}\nexecute tasks before plan approval`, traceability: [], assumptions: [], risks: [] }), /before approval/u);
});
