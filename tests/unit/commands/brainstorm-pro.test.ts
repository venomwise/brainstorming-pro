import test from "node:test";
import assert from "node:assert/strict";
import { parseBrainstormProArgs } from "../../../extensions/clarification-orchestrator/commands/brainstorm-pro.ts";

test("parses supported public command forms", () => {
  assert.deepEqual(parseBrainstormProArgs("\"Build a thing\""), { action: "start", request: "Build a thing" });
  assert.deepEqual(parseBrainstormProArgs("\"Build a thing\" --topic my-topic"), { action: "augment", request: "Build a thing", topic: "my-topic" });
  assert.deepEqual(parseBrainstormProArgs("--topic my-topic"), { action: "resume", topic: "my-topic", decision: undefined });
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic"), { action: "resume", topic: "my-topic", decision: undefined });
  assert.deepEqual(parseBrainstormProArgs("--resume --topic my-topic"), { action: "resume", topic: "my-topic", decision: undefined });
  assert.deepEqual(parseBrainstormProArgs("--status --topic my-topic"), { action: "status", topic: "my-topic" });
});

test("parses runtime helper decisions only with resume", () => {
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic --choose-review skip"), { action: "resume", topic: "my-topic", decision: { type: "review-mode", mode: "skip", user: "command-user" } });
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic --choose-review minimal"), { action: "resume", topic: "my-topic", decision: { type: "review-mode", mode: "minimal", user: "command-user" } });
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic --choose-review full"), { action: "resume", topic: "my-topic", decision: { type: "review-mode", mode: "full", user: "command-user" } });
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic --decision approve"), { action: "resume", topic: "my-topic", decision: { type: "approval", action: "approve", user: "command-user" } });
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic --decision revise"), { action: "resume", topic: "my-topic", decision: { type: "approval", action: "revise", user: "command-user" } });
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic --decision status"), { action: "resume", topic: "my-topic", decision: { type: "approval", action: "status", user: "command-user" } });
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic --decision exit"), { action: "resume", topic: "my-topic", decision: { type: "approval", action: "exit", user: "command-user" } });
});

test("rejects invalid parser combinations and helper values", () => {
  assert.throws(() => parseBrainstormProArgs("--decision approve"), /through \/brainstorm-pro --resume/);
  assert.throws(() => parseBrainstormProArgs("--choose-review minimal"), /through \/brainstorm-pro --resume/);
  assert.throws(() => parseBrainstormProArgs("--resume --choose-review fast"), /skip, minimal, or full/);
  assert.throws(() => parseBrainstormProArgs("--resume --decision maybe"), /approve, revise, status, or exit/);
  assert.throws(() => parseBrainstormProArgs("--resume my-topic --choose-review minimal --decision approve"), /either a review mode or approval decision/);
  assert.throws(() => parseBrainstormProArgs("--resume --status my-topic"), /either --resume or --status/);
  assert.throws(() => parseBrainstormProArgs("--resume my-topic --unknown"), /Unknown \/brainstorm-pro option '--unknown'/);
  assert.throws(() => parseBrainstormProArgs("--resume BadTopic"), /English kebab-case/);
  assert.throws(() => parseBrainstormProArgs("--plan-review-mode full"), /Plan review is automatic and fixed/);
  assert.throws(() => parseBrainstormProArgs("--choose-plan-review skip"), /Plan review is automatic and fixed/);
});
