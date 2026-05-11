import type { WorkflowLayout } from "../../artifact-store.ts";
import { writeDesignRevisionRequest } from "./ledger.ts";
import type { BoundDesignRevisionSources } from "./source-binding.ts";
import type { ClassifiedDesignRevisionQuestion } from "./user-questions.ts";
import type { DesignRevisionAuthorization, DesignRevisionRequest } from "./types.ts";

export async function buildAndWriteDesignRevisionRequest(input: {
  layout: WorkflowLayout;
  authorization: DesignRevisionAuthorization;
  sources: BoundDesignRevisionSources;
  questions: ClassifiedDesignRevisionQuestion[];
  requestedAt?: string;
}): Promise<DesignRevisionRequest> {
  const request = buildDesignRevisionRequest(input);
  await writeDesignRevisionRequest(input.layout, request);
  return request;
}

export function buildDesignRevisionRequest(input: {
  authorization: DesignRevisionAuthorization;
  sources: BoundDesignRevisionSources;
  questions: ClassifiedDesignRevisionQuestion[];
  requestedAt?: string;
}): DesignRevisionRequest {
  const mustFixClusterIds = input.sources.triage.clusters.filter((cluster) => cluster.triageLevel === "must-fix" || cluster.requiresRevision).map((cluster) => cluster.clusterId);
  const shouldFixClusterIds = input.sources.triage.clusters.filter((cluster) => cluster.triageLevel === "should-fix").map((cluster) => cluster.clusterId);
  const conflictIds = input.sources.triage.conflicts.filter((conflict) => conflict.impact !== "informational").map((conflict) => conflict.conflictId);
  return {
    revisionId: input.authorization.revisionId,
    workflowRunId: input.authorization.workflowRunId,
    topic: input.authorization.topic,
    sourceDesignRef: input.authorization.sourceDesignRef,
    sourceReviewRunId: input.authorization.sourceReviewRunId,
    sourceTriageRef: input.authorization.sourceTriageRef,
    sourceReadinessRef: input.authorization.sourceReadinessRef,
    mustFixClusterIds,
    shouldFixClusterIds,
    conflictIds,
    unresolvedQuestionIds: input.questions.map((question) => question.questionId),
    carryForwardQuestionIds: input.questions.filter((question) => question.disposition === "carry-forward").map((question) => question.questionId),
    userAnswers: input.authorization.userAnswers,
    ...(input.authorization.userInstructions ? { userInstructions: input.authorization.userInstructions } : {}),
    roundPolicy: input.authorization.roundPolicy,
    postRevisionReview: input.authorization.postRevisionReview,
    triage: {
      summary: input.sources.triage.summary,
      clusters: input.sources.triage.clusters,
      conflicts: input.sources.triage.conflicts,
      unresolvedQuestions: input.sources.triage.unresolvedQuestions,
    },
    readiness: input.sources.triage.readiness,
    requestedAt: input.requestedAt ?? new Date().toISOString(),
  };
}
