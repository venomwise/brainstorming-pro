import assert from "node:assert/strict";
import test from "node:test";
import {
  formatWorkflowScrollInfo,
  fuzzyFilterWorkflowItems,
  padWorkflowText,
  renderWorkflowFooter,
  renderWorkflowHeader,
  renderWorkflowRow,
  stripAnsi,
  truncateWorkflowToWidth,
  visibleWorkflowWidth,
  type WorkflowTheme,
} from "../../extensions/clarification-orchestrator/tui/render-helpers.ts";

const plainTheme: WorkflowTheme = {
  fg(_scope, text) {
    return text;
  },
};

test("ANSI stripping and visible width preserve colored text boundaries", () => {
  assert.equal(stripAnsi("\u001B[31mred\u001B[0m"), "red");
  assert.equal(visibleWorkflowWidth("\u001B[31mred\u001B[0m"), 3);
  assert.equal(truncateWorkflowToWidth("\u001B[31mabcdef\u001B[0m", 3), "\u001B[31mabc");
});

test("Unicode and emoji widths are handled for truncation and padding", () => {
  assert.equal(visibleWorkflowWidth("a界🙂"), 5);
  assert.equal(truncateWorkflowToWidth("a界🙂b", 3), "a界");
  assert.equal(padWorkflowText("界", 4), "界  ");
});

test("row rendering is single-line and width-aware for narrow terminals", () => {
  assert.equal(renderWorkflowRow("hello\nworld", 8, plainTheme), "│hello │");
  assert.equal(renderWorkflowRow("abcdef", 4, plainTheme), "│ab│");
  assert.equal(renderWorkflowRow("abcdef", 1, plainTheme), "││");
});

test("headers and footers fit compact and expanded line budgets", () => {
  assert.equal(visibleWorkflowWidth(renderWorkflowHeader("BP", 10, plainTheme)), 10);
  assert.equal(visibleWorkflowWidth(renderWorkflowFooter("done", 12, plainTheme)), 12);
  assert.equal(renderWorkflowHeader("LongTitle", 4, plainTheme), "╭LongTitle╮");
});

test("scroll info and fuzzy filtering support workflow item rendering", () => {
  assert.equal(formatWorkflowScrollInfo(0, 0), "");
  assert.equal(formatWorkflowScrollInfo(3, 2), "↑ 3 more  ↓ 2 more");

  const items = [
    { name: "design", description: "create design", model: "openai/gpt-4.1" },
    { name: "review", description: "review artifacts", model: "anthropic/claude" },
  ];
  assert.deepEqual(fuzzyFilterWorkflowItems(items, "rev").map((item) => item.name), ["review"]);
  assert.deepEqual(fuzzyFilterWorkflowItems(items, "").map((item) => item.name), ["design", "review"]);
});
