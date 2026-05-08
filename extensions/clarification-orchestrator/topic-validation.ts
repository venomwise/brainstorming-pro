export const CLARIFICATION_TOPIC_FORMAT_MESSAGE = "Clarification topics must be English kebab-case, for example 'task-dispatch-status'. Use lowercase ASCII letters and numbers separated by single hyphens.";

const clarificationTopicPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function isClarificationTopicSlug(topic: string): boolean {
  try {
    validateClarificationTopicSlug(topic);
    return true;
  } catch {
    return false;
  }
}

export function validateClarificationTopicSlug(topic: string): string {
  if (!topic || topic.includes("/") || topic.includes("\\") || topic.includes("..") || topic.startsWith(".")) {
    throw new Error(CLARIFICATION_TOPIC_FORMAT_MESSAGE);
  }
  if (!clarificationTopicPattern.test(topic)) throw new Error(CLARIFICATION_TOPIC_FORMAT_MESSAGE);
  return topic;
}
