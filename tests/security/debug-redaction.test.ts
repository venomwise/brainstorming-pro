import test from "node:test";
import assert from "node:assert/strict";
import { bundledDefaults } from "../../extensions/clarification-orchestrator/config.ts";
import { redactString, redactValue } from "../../extensions/clarification-orchestrator/debug-artifacts.ts";

test("debug redaction removes obvious secrets", () => {
  const config = { ...bundledDefaults, security: { ...bundledDefaults.security, debugArtifacts: "redacted" as const } };
  assert.match(redactString("token=abc user@example.com", config), /token=\[REDACTED\]/);
  assert.match(redactString("token=abc user@example.com", config), /\[REDACTED_EMAIL\]/);
  assert.deepEqual(redactValue({ password: "abc" }, config), { password: "[REDACTED]" });
});
