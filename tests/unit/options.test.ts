import test from "node:test";
import assert from "node:assert/strict";
import { parseClarifyArgs, parseCleanArgs, parseDiffArgs, tokenizeArgs } from "../../extensions/clarification-orchestrator/options.ts";

test("parseClarifyArgs preserves natural-language request", () => {
  const options = parseClarifyArgs("build a better onboarding flow");
  assert.equal(options.request, "build a better onboarding flow");
  assert.equal(options.resume, false);
  assert.equal(options.verbose, false);
  assert.equal(options.dryRun, false);
  assert.equal("topic" in options, false);
});

test("parseClarifyArgs preserves quoted and Chinese request text", () => {
  const options = parseClarifyArgs('"改进 登录 流程" --verbose --dry-run');
  assert.equal(options.request, "改进 登录 流程");
  assert.equal(options.verbose, true);
  assert.equal(options.dryRun, true);
});

test("parseClarifyArgs supports resume without request", () => {
  const options = parseClarifyArgs("--resume");
  assert.equal(options.request, "");
  assert.equal(options.resume, true);
});

test("parseClarifyArgs rejects missing request without resume", () => {
  assert.throws(() => parseClarifyArgs(""), /Missing request.*\/clarify <request>/);
});

test("parseClarifyArgs rejects removed options", () => {
  for (const removed of ["--mode auto", "--threshold P2", "--max-rounds 3", "--reviewers product,risk"]) {
    assert.throws(() => parseClarifyArgs(`request ${removed}`), /no longer supported/);
  }
});

test("parseClarifyArgs rejects unknown options", () => {
  assert.throws(() => parseClarifyArgs("request --unknown"), /Unknown option/);
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
