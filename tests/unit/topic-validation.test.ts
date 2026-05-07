import test from "node:test";
import assert from "node:assert/strict";
import { CLARIFICATION_TOPIC_FORMAT_MESSAGE, isClarificationTopicSlug, validateClarificationTopicSlug } from "../../extensions/clarification-orchestrator/topic-validation.ts";

for (const topic of ["task-dispatch-status", "payment-integration", "user-auth-v2"]) {
  test(`validateClarificationTopicSlug accepts ${topic}`, () => {
    assert.doesNotThrow(() => validateClarificationTopicSlug(topic));
    assert.equal(isClarificationTopicSlug(topic), true);
  });
}

for (const topic of ["中文", "café", "foo bar", "foo_bar", "Foo", "foo/bar", "foo\\bar", "-foo", "foo-", "foo--bar", ".hidden", ""]) {
  test(`validateClarificationTopicSlug rejects ${JSON.stringify(topic)}`, () => {
    assert.throws(() => validateClarificationTopicSlug(topic), /English kebab-case|path separators|dot|empty/i);
    assert.equal(isClarificationTopicSlug(topic), false);
  });
}

test("clarification topic format message gives an example", () => {
  assert.match(CLARIFICATION_TOPIC_FORMAT_MESSAGE, /task-dispatch-status/);
  assert.match(CLARIFICATION_TOPIC_FORMAT_MESSAGE, /English kebab-case/);
});
