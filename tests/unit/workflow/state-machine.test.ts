import test from "node:test";
import assert from "node:assert/strict";
import { canTransition, transition } from "../../../extensions/clarification-orchestrator/workflow/state-machine.ts";

test("allows core happy path transitions", () => {
  assert.equal(transition("designing", "awaiting-design-review-decision"), "awaiting-design-review-decision");
  assert.equal(transition("awaiting-design-review-decision", "awaiting-design-approval", { reviewMode: "skip" }), "awaiting-design-approval");
  assert.equal(transition("awaiting-design-approval", "planning"), "planning");
  assert.equal(transition("planning", "awaiting-plan-review-decision"), "awaiting-plan-review-decision");
  assert.equal(transition("awaiting-plan-review-decision", "awaiting-plan-approval", { reviewMode: "skip" }), "awaiting-plan-approval");
  assert.equal(transition("awaiting-plan-approval", "executing"), "executing");
  assert.equal(transition("executing", "done"), "done");
});

test("enforces review decision mode boundaries", () => {
  assert.equal(canTransition("awaiting-design-review-decision", "awaiting-design-approval"), false);
  assert.equal(canTransition("awaiting-design-review-decision", "awaiting-design-approval", { reviewMode: "skip" }), true);
  assert.equal(canTransition("awaiting-design-review-decision", "design-review", { reviewMode: "minimal" }), true);
  assert.equal(canTransition("awaiting-design-review-decision", "design-review", { reviewMode: "full" }), true);
  assert.equal(canTransition("awaiting-design-review-decision", "design-review", { reviewMode: "skip" }), false);

  assert.equal(canTransition("awaiting-plan-review-decision", "awaiting-plan-approval"), false);
  assert.equal(canTransition("awaiting-plan-review-decision", "awaiting-plan-approval", { reviewMode: "skip" }), true);
  assert.equal(canTransition("awaiting-plan-review-decision", "plan-review", { reviewMode: "minimal" }), true);
  assert.equal(canTransition("awaiting-plan-review-decision", "plan-review", { reviewMode: "full" }), true);
});

test("rejects illegal and terminal transitions", () => {
  assert.equal(canTransition("designing", "planning"), false);
  assert.equal(canTransition("done", "designing"), false);
  assert.throws(() => transition("done", "executing"), /Illegal workflow transition/);
});

test("allows safe blocked and failed recovery boundaries", () => {
  assert.equal(canTransition("designing", "blocked"), true);
  assert.equal(canTransition("planning", "failed"), true);
  assert.equal(canTransition("blocked", "planning"), true);
  assert.equal(canTransition("blocked", "done"), false);
  assert.equal(canTransition("blocked", "awaiting-design-approval"), false);
  assert.equal(canTransition("blocked", "awaiting-design-approval", { acceptIncompleteDesignReview: true }), true);
  assert.equal(canTransition("blocked", "awaiting-design-approval", { retryDesignReviewSucceeded: true }), true);
  assert.equal(canTransition("failed", "blocked"), true);
  assert.equal(canTransition("failed", "executing"), false);
});
