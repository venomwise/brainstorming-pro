import test from "node:test";
import assert from "node:assert/strict";
import { buildTopicChoices, findSimilarExistingTopics, generateTopicCandidates, renderTopicChoices } from "../../extensions/clarification-orchestrator/topic-proposal.ts";

test("generateTopicCandidates produces english candidates", () => {
  const candidates = generateTopicCandidates("improve onboarding flow for new users", []);
  assert.ok(candidates.length >= 1);
  assert.match(candidates[0].slug, /^[a-z0-9-]+$/);
  assert.equal(candidates[0].language, "en");
  assert.equal(candidates[0].displayName.includes("onboarding"), true);
});

test("generateTopicCandidates produces chinese gloss metadata", () => {
  const candidates = generateTopicCandidates("改进 登录 流程", []);
  assert.ok(candidates.length >= 1);
  assert.equal(candidates[0].language, "zh");
  assert.ok(candidates[0].gloss?.includes("login") || candidates[0].gloss?.includes("flow"));
});

test("generateTopicCandidates marks weak generic topics", () => {
  const candidates = generateTopicCandidates("feature", []);
  assert.ok(candidates.length >= 1);
  assert.equal(candidates[0].strength, "weak");
  assert.ok(candidates[0].warnings.length > 0);
});

test("findSimilarExistingTopics detects near duplicates", () => {
  assert.deepEqual(findSimilarExistingTopics("login-flow", ["login-flow", "sign-in-flow", "billing"]), ["login-flow", "sign-in-flow"]);
});

test("buildTopicChoices surfaces reuse and manual options", () => {
  const candidates = generateTopicCandidates("billing workflow", ["billing-workflow"]);
  const choices = buildTopicChoices(candidates);
  assert.ok(choices.some((choice) => choice.action === "manual"));
  assert.ok(choices.some((choice) => choice.action === "reuse-existing"));
});

test("renderTopicChoices includes candidate details", () => {
  const candidates = generateTopicCandidates("改进 登录 流程", []);
  const rendered = renderTopicChoices(candidates);
  assert.match(rendered, /source:/);
  assert.match(rendered, /gloss:/);
});
