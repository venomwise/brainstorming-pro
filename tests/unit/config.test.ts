import test from "node:test";
import assert from "node:assert/strict";
import { bundledDefaults, detectSecuritySensitiveChanges, mergeConfig, requiresUserConfirmation, validateConfig } from "../../extensions/clarification-orchestrator/config.ts";

test("mergeConfig overrides scalars and arrays", () => {
  const result = mergeConfig(bundledDefaults, {
    defaults: { ...bundledDefaults.defaults, maxRounds: 5 },
    reviewers: { ...bundledDefaults.reviewers, enabled: ["product"] },
  });
  assert.equal(result.defaults.maxRounds, 5);
  assert.deepEqual(result.reviewers.enabled, ["product"]);
});

test("detectSecuritySensitiveChanges flags project agents", () => {
  const changes = detectSecuritySensitiveChanges({ security: { ...bundledDefaults.security, allowProjectAgents: true } }, "config.json");
  assert.equal(changes.length, 1);
  assert.equal(requiresUserConfirmation(changes), true);
});

test("validateConfig accepts bundled defaults", () => {
  assert.equal(validateConfig(bundledDefaults).version, 1);
});
