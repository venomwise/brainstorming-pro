import assert from "node:assert/strict";
import test from "node:test";
import {
  formatWorkflowDuration,
  formatWorkflowStepSummary,
  formatWorkflowTokens,
  formatWorkflowUsage,
  shortenWorkflowPath,
} from "../../extensions/clarification-orchestrator/tui/formatters.ts";

test("formatWorkflowTokens handles compact token boundaries", () => {
  assert.equal(formatWorkflowTokens(0), "0");
  assert.equal(formatWorkflowTokens(999), "999");
  assert.equal(formatWorkflowTokens(1000), "1.0k");
  assert.equal(formatWorkflowTokens(9999), "10.0k");
  assert.equal(formatWorkflowTokens(10000), "10k");
  assert.equal(formatWorkflowTokens(-5), "0");
});

test("formatWorkflowDuration handles millisecond, second, and minute boundaries", () => {
  assert.equal(formatWorkflowDuration(999), "999ms");
  assert.equal(formatWorkflowDuration(1000), "1.0s");
  assert.equal(formatWorkflowDuration(59999), "60.0s");
  assert.equal(formatWorkflowDuration(60000), "1m0s");
  assert.equal(formatWorkflowDuration(125432), "2m5s");
  assert.equal(formatWorkflowDuration(Number.NaN), "0ms");
});

test("formatWorkflowUsage creates compact workflow usage summaries", () => {
  assert.equal(
    formatWorkflowUsage({ turns: 2, input: 1500, output: 999, cacheRead: 10000, cacheWrite: 1200, cost: 0.12345 }, "openai/gpt-4.1"),
    "2 turns in:1.5k out:999 R10k W1.2k $0.1235 openai/gpt-4.1",
  );
  assert.equal(formatWorkflowUsage({}, undefined), "");
});

test("shortenWorkflowPath only shortens paths under home", () => {
  assert.equal(shortenWorkflowPath("/home/user/project/specs/topic", "/home/user"), "~/project/specs/topic");
  assert.equal(shortenWorkflowPath("/home/user", "/home/user"), "~");
  assert.equal(shortenWorkflowPath("/home/userland/project", "/home/user"), "/home/userland/project");
});

test("formatWorkflowStepSummary uses workflow terminology without upstream chain API", () => {
  assert.equal(formatWorkflowStepSummary([]), "No workflow steps recorded.");
  assert.equal(
    formatWorkflowStepSummary([{ name: "design", durationMs: 1000, status: "completed" }]),
    "✅ Workflow steps completed: design (1 step, 1.0s)",
  );
  assert.equal(
    formatWorkflowStepSummary([
      { name: "design", durationMs: 1000, status: "completed" },
      { name: "review", durationMs: 2000, status: "failed" },
    ]),
    "❌ Workflow failed at review: design → review (2 steps, 3.0s)",
  );
});
