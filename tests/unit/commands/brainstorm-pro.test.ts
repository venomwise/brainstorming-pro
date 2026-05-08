import test from "node:test";
import assert from "node:assert/strict";
import { parseBrainstormProArgs } from "../../../extensions/clarification-orchestrator/commands/brainstorm-pro.ts";

test("parses start, augment, topic resume, status, and decisions", () => {
  assert.deepEqual(parseBrainstormProArgs("\"Build a thing\""), { action: "start", request: "Build a thing" });
  assert.deepEqual(parseBrainstormProArgs("\"Build a thing\" --topic my-topic"), { action: "augment", request: "Build a thing", topic: "my-topic" });
  assert.deepEqual(parseBrainstormProArgs("--topic my-topic"), { action: "resume", topic: "my-topic", decision: undefined });
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic"), { action: "resume", topic: "my-topic", decision: undefined });
  assert.deepEqual(parseBrainstormProArgs("--status --topic my-topic"), { action: "status", topic: "my-topic" });
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic --choose-review minimal"), { action: "resume", topic: "my-topic", decision: { type: "review-mode", mode: "minimal", user: "command-user" } });
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic --decision approve"), { action: "resume", topic: "my-topic", decision: { type: "approval", action: "approve", user: "command-user" } });
});

test("rejects bypass-style decisions outside resume", () => {
  assert.throws(() => parseBrainstormProArgs("--decision approve"), /through \/brainstorm-pro --resume/);
  assert.throws(() => parseBrainstormProArgs("--resume --choose-review fast"), /skip, minimal, or full/);
});
