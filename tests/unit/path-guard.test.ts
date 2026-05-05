import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { assertUnderSpecRoot, normalizeTopic, resolveSpecPaths } from "../../extensions/clarification-orchestrator/path-guard.ts";

test("normalizeTopic creates kebab slug", () => {
  assert.equal(normalizeTopic("My Feature!!").slug, "my-feature");
});

test("normalizeTopic preserves unicode", () => {
  assert.equal(normalizeTopic("复杂 需求").slug, "复杂-需求");
});

test("normalizeTopic rejects path traversal", () => {
  assert.throws(() => normalizeTopic("../secret"), /path separators|\.\./);
});

test("resolveSpecPaths returns paths under specs", () => {
  const result = resolveSpecPaths("/tmp/project", "My Feature");
  assert.equal(result.slug, "my-feature");
  assert.equal(result.designPath, path.resolve("/tmp/project/specs/my-feature/design.md"));
});

test("assertUnderSpecRoot rejects outside path", () => {
  assert.throws(() => assertUnderSpecRoot("/tmp/outside", "/tmp/project/specs"), /Unsafe path/);
});
