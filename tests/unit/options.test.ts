import test from "node:test";
import assert from "node:assert/strict";
import { parseClarifyArgs, parseCleanArgs, parseDiffArgs, tokenizeArgs } from "../../extensions/clarification-orchestrator/options.ts";

test("parseClarifyArgs applies defaults", () => {
  const options = parseClarifyArgs("my feature");
  assert.equal(options.topic, "my feature");
  assert.equal(options.mode, "hybrid");
  assert.equal(options.maxRounds, 2);
  assert.deepEqual(options.reviewers, ["product", "architecture", "risk", "testing"]);
});

test("parseClarifyArgs parses options", () => {
  const options = parseClarifyArgs('"my feature" --mode auto --max-rounds 3 --threshold P2 --reviewers product,risk --resume --verbose --dry-run');
  assert.equal(options.topic, "my feature");
  assert.equal(options.mode, "auto");
  assert.equal(options.maxRounds, 3);
  assert.equal(options.threshold, "P2");
  assert.deepEqual(options.reviewers, ["product", "risk"]);
  assert.equal(options.resume, true);
  assert.equal(options.verbose, true);
  assert.equal(options.dryRun, true);
});

test("parseClarifyArgs rejects invalid mode", () => {
  assert.throws(() => parseClarifyArgs("x --mode fast"), /Invalid --mode/);
});

test("parseDiffArgs requires both run IDs", () => {
  assert.throws(() => parseDiffArgs("topic run1"), /both run IDs/);
});

test("parseCleanArgs parses dry run and keep", () => {
  assert.deepEqual(parseCleanArgs("topic --dry-run --keep 4"), { topic: "topic", dryRun: true, keep: 4 });
});

test("tokenizeArgs supports quoted tokens", () => {
  assert.deepEqual(tokenizeArgs('one "two three"'), ["one", "two three"]);
});
