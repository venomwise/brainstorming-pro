import type { DesignReviewTriageReport, DesignReviewUnresolvedQuestion } from "../design-review/types.ts";
import type { DesignRevisionUserAnswer, DesignRevisionUserQuestionDisposition } from "./types.ts";

export type ClassifiedDesignRevisionQuestion = DesignReviewUnresolvedQuestion & {
  disposition: DesignRevisionUserQuestionDisposition;
};

export type UserQuestionGateResult =
  | { status: "ready"; questions: ClassifiedDesignRevisionQuestion[]; blockingQuestionIds: string[] }
  | { status: "needs-user-input"; questions: ClassifiedDesignRevisionQuestion[]; blockingQuestionIds: string[]; missingQuestionIds: string[] }
  | { status: "invalid-answers"; questions: ClassifiedDesignRevisionQuestion[]; unknownQuestionIds: string[] };

export function evaluateUserQuestionGate(triage: DesignReviewTriageReport, answers: readonly DesignRevisionUserAnswer[]): UserQuestionGateResult {
  const questions = triage.unresolvedQuestions.map(classifyDesignRevisionQuestion);
  const knownQuestionIds = new Set(questions.map((question) => question.questionId));
  const unknownQuestionIds = answers.map((answer) => answer.questionId).filter((questionId) => !knownQuestionIds.has(questionId));
  if (unknownQuestionIds.length > 0) return { status: "invalid-answers", questions, unknownQuestionIds };

  const answeredIds = new Set(answers.map((answer) => answer.questionId));
  const blockingQuestionIds = questions.filter((question) => question.disposition === "requires-user-answer-before-revision").map((question) => question.questionId);
  const missingQuestionIds = blockingQuestionIds.filter((questionId) => !answeredIds.has(questionId));
  if (missingQuestionIds.length > 0) return { status: "needs-user-input", questions, blockingQuestionIds, missingQuestionIds };
  return { status: "ready", questions, blockingQuestionIds };
}

export function classifyDesignRevisionQuestion(question: DesignReviewUnresolvedQuestion): ClassifiedDesignRevisionQuestion {
  if (question.blocking) return { ...question, disposition: "requires-user-answer-before-revision" };
  const text = `${question.question} ${question.relatedSections.join(" ")}`.toLowerCase();
  if (/\b(product|scope|trade-?off|risk|security|privacy|data retention|deadline|user decision|choose|which)\b/u.test(text)) {
    return { ...question, disposition: "requires-user-answer-before-revision" };
  }
  if (/\b(wording|clarify|explain|document|section|format)\b/u.test(text)) return { ...question, disposition: "reviser-can-address" };
  return { ...question, disposition: "carry-forward" };
}
