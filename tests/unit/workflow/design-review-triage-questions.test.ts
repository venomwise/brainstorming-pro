import test from "node:test";
import assert from "node:assert/strict";
import { extractDesignReviewUnresolvedQuestions } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/triage-questions.ts";

const designRef = { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "abc", createdAt: "2026-01-01T00:00:00.000Z" };

test("groups duplicate unresolved questions", () => {
  const questions = extractDesignReviewUnresolvedQuestions([
    { id: "f-1", reviewRunId: "run-1", designRef, reviewerRole: "product-reviewer", category: "product", severity: "blocking", title: "Q", description: "Q", userQuestion: "Should this cover onboarding?", requiresRevision: true },
    { id: "f-2", reviewRunId: "run-1", designRef, reviewerRole: "architecture-reviewer", category: "architecture", severity: "blocking", title: "Q", description: "Q", userQuestion: "Should this cover onboarding?", requiresRevision: true },
  ] as never);
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0].sourceFindingIds, ["f-1", "f-2"]);
  assert.equal(questions[0].blocking, true);
});
