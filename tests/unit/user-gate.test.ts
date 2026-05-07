import test from "node:test";
import assert from "node:assert/strict";
import { confirmTopicCandidate } from "../../extensions/clarification-orchestrator/user-gate.ts";
import type { TopicCandidate } from "../../extensions/clarification-orchestrator/types.ts";

const candidates: TopicCandidate[] = [
  { slug: "payment-integration", displayName: "payment", sourcePhrase: "payment integration", language: "en", strength: "strong", warnings: [] },
];

test("confirmTopicCandidate accepts candidate number", async () => {
  const topic = await confirmTopicCandidate({ request: "payment", candidates, ctx: { hasUI: true, input: async () => "1" } });
  assert.equal(topic, "payment-integration");
});

test("confirmTopicCandidate supports manual retry and validates English kebab-case", async () => {
  const answers = ["manual", "中文", "task-dispatch-status"];
  const notifications: string[] = [];
  const topic = await confirmTopicCandidate({
    request: "中文",
    candidates: [],
    ctx: {
      hasUI: true,
      notify: (message) => notifications.push(message),
      input: async () => answers.shift(),
    },
  });
  assert.equal(topic, "task-dispatch-status");
  assert.match(notifications.join("\n"), /English kebab-case/);
});

test("confirmTopicCandidate cancellation and empty manual-only behavior", async () => {
  await assert.rejects(
    confirmTopicCandidate({ request: "x", candidates: [], ctx: { hasUI: true, input: async () => undefined } }),
    /cancelled/,
  );
  const answers = ["1", "manual-topic"];
  const topic = await confirmTopicCandidate({ request: "x", candidates: [], ctx: { hasUI: true, input: async () => answers.shift() } });
  assert.equal(topic, "manual-topic");
});

test("confirmTopicCandidate rejects invalid direct topic without creating side effects", async () => {
  await assert.rejects(
    confirmTopicCandidate({ request: "x", candidates, ctx: { hasUI: true, input: async () => "Bad Topic" } }),
    /English kebab-case/,
  );
});
