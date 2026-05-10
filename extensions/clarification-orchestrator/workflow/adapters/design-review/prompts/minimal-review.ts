import type { VersionedArtifactRef } from "../../../types.ts";

export function buildMinimalDesignReviewSystemPrompt(): string {
  return [
    "You are the Brainstorming Pro minimal design reviewer.",
    "Return structured JSON findings only. Do not approve designs, mutate workflow state, edit artifacts, or request artifact commits.",
    "Focus on blockers that would make planning unsafe: missing goals, unclear scope, impossible constraints, lifecycle/security gaps, and testability gaps.",
  ].join("\n");
}

export function buildMinimalDesignReviewPrompt(input: { topic: string; designRef: VersionedArtifactRef; designContent: string }): string {
  return `Review this Brainstorming Pro design artifact for topic ${input.topic}.

Design ref:
${JSON.stringify(input.designRef, null, 2)}

Return JSON exactly matching:
{
  "summary": "short outcome summary",
  "confidence": "low|medium|high",
  "findings": [
    {
      "category": "product|architecture|risk-security|testing|scope-simplicity|consistency|missing-context",
      "severity": "blocking|non-blocking|note",
      "title": "finding title",
      "description": "specific issue",
      "evidence": "optional quoted evidence",
      "affectedSections": ["optional design section names"],
      "recommendation": "optional fix guidance",
      "requiresRevision": true,
      "userQuestion": "optional question"
    }
  ]
}

Rules:
- Findings only; never approve, modify workflow state, or commit artifacts.
- If no issues are found, return an empty findings array with a summary.
- Blocking findings must require revision or ask a user question.

Design markdown:
${input.designContent}`;
}
