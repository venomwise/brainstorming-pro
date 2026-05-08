import test from "node:test";
import assert from "node:assert/strict";
import { tokenizeArgs } from "../../extensions/clarification-orchestrator/options.ts";

test("tokenizeArgs supports quoted tokens", () => {
  assert.deepEqual(tokenizeArgs('one "two three"'), ["one", "two three"]);
});

test("tokenizeArgs rejects unclosed quotes", () => {
  assert.throws(() => tokenizeArgs('one "two'), /Unclosed quote/);
});
