import test from "node:test";
import assert from "node:assert/strict";
import { bundledDefaults } from "../../extensions/clarification-orchestrator/config.ts";
import { buildTopicProposalPrompt, parseTopicProposalOutput, proposeTopicsWithModel } from "../../extensions/clarification-orchestrator/topic-proposal-agent.ts";

const config = { ...bundledDefaults, models: { default: "test/model", fallback: [] } };

test("buildTopicProposalPrompt requests semantic JSON English kebab-case", () => {
  const prompt = buildTopicProposalPrompt("做一个支付集成", ["payment-flow"]);
  assert.match(prompt, /Return ONLY JSON/);
  assert.match(prompt, /semantic English kebab-case/);
  assert.match(prompt, /not do word-for-word translation/);
});

test("parseTopicProposalOutput accepts fenced or plain JSON", () => {
  assert.deepEqual(parseTopicProposalOutput('{"candidates":["payment-integration","checkout-flow"]}'), ["payment-integration", "checkout-flow"]);
  assert.deepEqual(parseTopicProposalOutput('```json\n{"candidates":["user-auth-v2"]}\n```'), ["user-auth-v2"]);
});

test("proposeTopicsWithModel returns two to three valid candidates", async () => {
  const candidates = await proposeTopicsWithModel({
    request: "中文支付需求",
    existingTopics: [],
    cwd: process.cwd(),
    config,
    runModel: async () => '{"candidates":["payment-integration","checkout-payment","payment-status"]}',
  });
  assert.deepEqual(candidates.map((candidate) => candidate.slug), ["payment-integration", "checkout-payment", "payment-status"]);
  assert.equal(candidates.every((candidate) => candidate.strength === "strong"), true);
});

test("proposeTopicsWithModel filters invalid malicious duplicate and Unicode slugs", async () => {
  const candidates = await proposeTopicsWithModel({
    request: "中文登录需求",
    existingTopics: ["login-flow", "sign-in-flow"],
    cwd: process.cwd(),
    config,
    runModel: async () => JSON.stringify({ candidates: ["login-flow", "../evil", "ログイン", "login-flow", "user_auth", "auth-flow"] }),
  });
  assert.deepEqual(candidates.map((candidate) => candidate.slug), ["login-flow", "auth-flow"]);
  assert.equal(candidates[0].exactConflict, true);
  assert.deepEqual(candidates[0].similarTopics, ["sign-in-flow"]);
});

test("proposeTopicsWithModel invalid JSON or all-invalid output triggers empty manual fallback", async () => {
  await assert.rejects(
    proposeTopicsWithModel({ request: "中文", existingTopics: [], cwd: process.cwd(), config, runModel: async () => "not json" }),
    /valid JSON/,
  );
  const candidates = await proposeTopicsWithModel({ request: "中文", existingTopics: [], cwd: process.cwd(), config, runModel: async () => '{"candidates":["中文","../x","foo_bar"]}' });
  assert.deepEqual(candidates, []);
});

test("proposeTopicsWithModel helper does not create artifacts when using injected runner", async () => {
  let receivedPrompt = "";
  const candidates = await proposeTopicsWithModel({
    request: "订单状态通知",
    existingTopics: [],
    cwd: process.cwd(),
    config,
    runModel: async (prompt) => {
      receivedPrompt = prompt;
      return '{"candidates":["order-status-notification","order-notifications"]}';
    },
  });
  assert.match(receivedPrompt, /订单状态通知/);
  assert.deepEqual(candidates.map((candidate) => candidate.slug), ["order-status-notification", "order-notifications"]);
});
