import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { validateReviewerIssueQuality, validateRefinerQuality, validateTriagerConsistency, validateVerifierQuality } from "../../extensions/clarification-orchestrator/quality-gates.ts";
import { canonicalizeIssues } from "../../extensions/clarification-orchestrator/issues.ts";
import type { ReviewerOutput, RefinerOutput } from "../../extensions/clarification-orchestrator/types.ts";
import type { VerifierOutput } from "../../extensions/clarification-orchestrator/phases/verify.ts";

async function fixture<T>(path: string): Promise<T> {
  return JSON.parse(await fs.readFile(path, "utf8")) as T;
}

test("good deterministic fixtures pass quality gates", async () => {
  const reviewer = await fixture<ReviewerOutput>("tests/fixtures/good-design/reviewer-output.json");
  const issues = canonicalizeIssues(reviewer.issues, 1);
  const refiner = await fixture<RefinerOutput>("tests/fixtures/good-design/refiner-output.json");
  const verifier = await fixture<VerifierOutput>("tests/fixtures/good-design/verifier-output.json");
  assert.deepEqual(validateReviewerIssueQuality(reviewer.issues).filter((p) => p.severity === "error"), []);
  assert.deepEqual(validateTriagerConsistency(issues).filter((p) => p.severity === "error"), []);
  assert.deepEqual(validateRefinerQuality(refiner, [{ issueId: "BP-R1-I001", decision: "accept" }]).filter((p) => p.severity === "error"), []);
  assert.deepEqual(validateVerifierQuality(verifier.results, ["BP-R1-I001"]).filter((p) => p.severity === "error"), []);
});

test("bad deterministic fixtures fail before canonical state is trusted", async () => {
  const reviewer = await fixture<ReviewerOutput>("tests/fixtures/bad-design/reviewer-output.json");
  const refiner = await fixture<RefinerOutput>("tests/fixtures/bad-design/refiner-output.json");
  const verifier = await fixture<VerifierOutput>("tests/fixtures/bad-design/verifier-output.json");
  assert.ok(validateReviewerIssueQuality(reviewer.issues).some((p) => p.severity === "error"));
  assert.ok(validateTriagerConsistency(reviewer.issues).some((p) => p.severity === "error"));
  assert.ok(validateRefinerQuality(refiner, [{ issueId: "BP-R1-I001", decision: "accept" }, { issueId: "BP-R1-I002", decision: "reject" }]).some((p) => p.severity === "error"));
  assert.ok(validateVerifierQuality(verifier.results, ["BP-R1-I001"]).some((p) => p.severity === "error"));
});
