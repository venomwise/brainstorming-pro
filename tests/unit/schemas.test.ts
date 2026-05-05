import test from "node:test";
import assert from "node:assert/strict";
import { parseJsonOutput, buildRepairPrompt, formatValidationError, ValidationFailure } from "../../extensions/clarification-orchestrator/validation.ts";

test("parseJsonOutput parses plain JSON", () => {
  assert.deepEqual(parseJsonOutput('{"ok":true}'), { ok: true });
});

test("parseJsonOutput extracts fenced JSON", () => {
  assert.deepEqual(parseJsonOutput('```json\n{"ok":true}\n```'), { ok: true });
});

test("buildRepairPrompt includes schema and validation error", () => {
  const prompt = buildRepairPrompt({ schemaName: "Example", validationError: "x missing", rawOutput: "{}", expectedSchema: "{x:string}" });
  assert.match(prompt, /Example/);
  assert.match(prompt, /x missing/);
  assert.match(prompt, /ONLY corrected JSON/);
});

test("formatValidationError formats ValidationFailure", () => {
  const formatted = formatValidationError(new ValidationFailure("bad", [{ path: "$.x", message: "required", expected: "string", valueSummary: "undefined" }]));
  assert.match(formatted, /\$\.x/);
  assert.match(formatted, /required/);
});
