import { appendWorkflowEvent } from "../../events.ts";
import type { WorkflowLayout } from "../../artifact-store.ts";
import type { AgentBackedAdapterOptions } from "../agent-backed.ts";
import type { DesignReviewRun } from "../design-review/types.ts";
import { validateDesignRevisionAuthorization } from "./schemas.ts";
import { writeDesignRevisionAuthorization, writeDesignRevisionRecord } from "./ledger.ts";
import { evaluateRevisionEligibility } from "./eligibility.ts";
import { buildAndWriteDesignRevisionRequest } from "./request-builder.ts";
import { runDesignReviserAdapter } from "./reviser-adapter.ts";
import { collectKnownRevisionItemIds, validateAndWriteRevisedDesign } from "./validator.ts";
import { commitRevisedDesignArtifact } from "./artifact-commit.ts";
import { markSourceReviewEvidenceStale } from "./staleness.ts";
import {
  buildDesignRevisionAuthorizedEvent,
  buildDesignRevisionCommittedEvent,
  buildDesignRevisionFailedEvent,
  buildDesignRevisionNeedsUserInputEvent,
  buildDesignRevisionStaleInvalidatedEvent,
  buildDesignRevisionStartedEvent,
} from "./events.ts";
import type { DesignRevisionAuthorization, DesignRevisionRecord, DesignRevisionTerminalStatus } from "./types.ts";

export type DesignRevisionControllerResult =
  | { status: "committed"; record: DesignRevisionRecord }
  | { status: Exclude<DesignRevisionTerminalStatus, "committed">; record: DesignRevisionRecord };

export type DesignRevisionControllerOptions = AgentBackedAdapterOptions & {
  commitRevisedDesign?: typeof commitRevisedDesignArtifact;
};

export async function runDesignRevisionController(input: {
  layout: WorkflowLayout;
  authorization: unknown;
  reviewRun?: DesignReviewRun;
  options: DesignRevisionControllerOptions;
  now?: Date;
}): Promise<DesignRevisionControllerResult> {
  const startedAt = (input.now ?? new Date()).toISOString();
  let authorization: DesignRevisionAuthorization;
  try {
    authorization = validateDesignRevisionAuthorization(input.authorization);
  } catch (error) {
    const fallback = input.authorization as Partial<DesignRevisionAuthorization>;
    const record = terminalRecord({
      authorization: fallback,
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
      completedAt: startedAt,
    });
    await writeDesignRevisionRecord(input.layout, record);
    return { status: "failed", record };
  }

  await writeDesignRevisionAuthorization(input.layout, authorization);
  await appendWorkflowEvent(input.layout, buildDesignRevisionAuthorizedEvent(authorization));

  const consumedAuthorization: DesignRevisionAuthorization = { ...authorization, consumedAt: startedAt };
  await writeDesignRevisionAuthorization(input.layout, consumedAuthorization);
  await appendWorkflowEvent(input.layout, buildDesignRevisionStartedEvent({ authorization, startedAt }));

  const eligibility = await evaluateRevisionEligibility({ layout: input.layout, authorization, reviewRun: input.reviewRun });
  if (eligibility.status === "denied") {
    const status = statusForDenial(eligibility.reason);
    const record = terminalRecord({
      authorization,
      status,
      reason: eligibility.message,
      completedAt: startedAt,
      blockingQuestionIds: eligibility.userQuestionGate?.status === "needs-user-input" ? eligibility.userQuestionGate.missingQuestionIds : undefined,
    });
    await writeDesignRevisionRecord(input.layout, record);
    if (status === "needs-user-input") {
      await appendWorkflowEvent(input.layout, buildDesignRevisionNeedsUserInputEvent({ revisionId: authorization.revisionId, blockingQuestionIds: record.blockingQuestionIds ?? [], recordedAt: startedAt }));
    } else {
      await appendWorkflowEvent(input.layout, buildDesignRevisionFailedEvent(record));
    }
    return { status, record };
  }

  const request = await buildAndWriteDesignRevisionRequest({
    layout: input.layout,
    authorization,
    sources: eligibility.sources,
    questions: eligibility.userQuestionGate.questions,
    requestedAt: startedAt,
  });
  const knownItemIds = collectKnownRevisionItemIds({
    clusterIds: eligibility.sources.triage.clusters.map((cluster) => cluster.clusterId),
    conflictIds: eligibility.sources.triage.conflicts.map((conflict) => conflict.conflictId),
    questionIds: eligibility.sources.triage.unresolvedQuestions.map((question) => question.questionId),
  });

  const adapterResult = await runDesignReviserAdapter({ layout: input.layout, request, sourceDesignMarkdown: eligibility.sources.designContent, options: input.options, knownItemIds });
  if (adapterResult.status === "failed") {
    const record = terminalRecord({ authorization, status: "failed", reason: adapterResult.reason, completedAt: startedAt });
    await writeDesignRevisionRecord(input.layout, record);
    await appendWorkflowEvent(input.layout, buildDesignRevisionFailedEvent(record));
    return { status: "failed", record };
  }

  const validation = await validateAndWriteRevisedDesign({ layout: input.layout, revisionId: authorization.revisionId, output: adapterResult.output, knownItemIds, validatedAt: startedAt });
  if (validation.status === "failed" || !validation.output) {
    const record = terminalRecord({ authorization, status: "failed", reason: validation.diagnostics.join("; ") || "Revised design validation failed.", completedAt: startedAt });
    await writeDesignRevisionRecord(input.layout, record);
    await appendWorkflowEvent(input.layout, buildDesignRevisionFailedEvent(record));
    return { status: "failed", record };
  }

  let targetDesignRef;
  try {
    targetDesignRef = await (input.options.commitRevisedDesign ?? commitRevisedDesignArtifact)(input.layout, validation.output.revisedDesignMarkdown, input.now);
  } catch (error) {
    const record = terminalRecord({ authorization, status: "failed", reason: error instanceof Error ? error.message : String(error), completedAt: startedAt, output: validation.output });
    await writeDesignRevisionRecord(input.layout, record);
    await appendWorkflowEvent(input.layout, buildDesignRevisionFailedEvent(record));
    return { status: "failed", record };
  }

  const record = terminalRecord({ authorization, status: "committed", completedAt: startedAt, output: validation.output, targetDesignRef });
  await writeDesignRevisionRecord(input.layout, record);
  await appendWorkflowEvent(input.layout, buildDesignRevisionCommittedEvent(record));
  const stale = markSourceReviewEvidenceStale({ staleSourceDesignRef: authorization.sourceDesignRef, revisedDesignRef: targetDesignRef, sourceReviewRunId: authorization.sourceReviewRunId, invalidatedAt: startedAt });
  await appendWorkflowEvent(input.layout, buildDesignRevisionStaleInvalidatedEvent({ revisionId: authorization.revisionId, targetDesignRef, staleReviewRunId: stale.sourceReviewRunId, invalidatedAt: stale.invalidatedAt }));
  return { status: "committed", record };
}

function statusForDenial(reason: string): Exclude<DesignRevisionTerminalStatus, "committed"> {
  if (reason === "revision-exhausted") return "revision-exhausted";
  if (reason === "stale-source" || reason === "path-escape") return "stale-source";
  if (reason === "needs-user-input" || reason === "unknown-user-answer") return "needs-user-input";
  return "blocked";
}

function terminalRecord(input: {
  authorization: Partial<DesignRevisionAuthorization>;
  status: DesignRevisionTerminalStatus;
  reason?: string;
  completedAt: string;
  output?: { resolvedItemIds: string[]; unresolvedItemIds: string[]; changeSummary: string[] };
  targetDesignRef?: DesignRevisionRecord["targetDesignRef"];
  blockingQuestionIds?: string[];
}): DesignRevisionRecord {
  const sourceDesignRef = input.authorization.sourceDesignRef ?? { kind: "design", version: 0, path: "unknown", checksum: "unknown", createdAt: input.completedAt };
  return {
    revisionId: input.authorization.revisionId ?? "unknown-revision",
    workflowRunId: input.authorization.workflowRunId ?? "unknown-run",
    topic: input.authorization.topic ?? "unknown-topic",
    status: input.status,
    sourceDesignRef,
    ...(input.targetDesignRef ? { targetDesignRef: input.targetDesignRef } : {}),
    sourceReviewRunId: input.authorization.sourceReviewRunId ?? "unknown-review-run",
    sourceTriageRef: input.authorization.sourceTriageRef ?? { path: "unknown", checksum: "unknown" },
    sourceReadinessRef: input.authorization.sourceReadinessRef ?? { path: "unknown", checksum: "unknown" },
    ...(input.authorization.sourceCoverageRef ? { sourceCoverageRef: input.authorization.sourceCoverageRef } : {}),
    resolvedItemIds: input.output?.resolvedItemIds ?? [],
    unresolvedItemIds: input.output?.unresolvedItemIds ?? [],
    ...(input.blockingQuestionIds ? { blockingQuestionIds: input.blockingQuestionIds } : {}),
    changeSummary: input.output?.changeSummary ?? [],
    ...(input.reason ? { reason: input.reason } : {}),
    completedAt: input.completedAt,
  };
}
