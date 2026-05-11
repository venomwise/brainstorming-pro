import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createWorkflowLayout } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { runDesignReviserAdapter } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-revision/reviser-adapter.ts";
import { validateRevisedDesignOutput } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-revision/validator.ts";
import type { DesignRevisionRequest } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-revision/types.ts";
import { createFailedAgentRunResult, emptyOutputCaptureSummary, type AgentRunResult } from "../../../extensions/clarification-orchestrator/runtime/agent-execution/types.ts";

const validMarkdown = "# Design\n\n## Summary\nUpdated\n\n## Goals\nGoal\n\n## Non-Goals\nNone\n\n## Proposed Solution\nSolution\n\n## Requirements Traceability\nTrace";

function request(): DesignRevisionRequest {
  return {
    revisionId: "rev-1",
    workflowRunId: "run-1",
    topic: "demo-topic",
    sourceDesignRef: { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "sha", createdAt: "2026-05-11T00:00:00.000Z" },
    sourceReviewRunId: "review-1",
    sourceTriageRef: { path: "triage.json", checksum: "sha" },
    sourceReadinessRef: { path: "readiness.json", checksum: "sha" },
    mustFixClusterIds: ["cluster-1"],
    shouldFixClusterIds: [],
    conflictIds: [],
    unresolvedQuestionIds: ["q-1"],
    carryForwardQuestionIds: [],
    userAnswers: [],
    roundPolicy: { maxTotalRevisionRounds: 3, maxTotalPostRevisionReviewRounds: 3, usedRevisionRounds: 0, usedPostRevisionReviewRounds: 0 },
    postRevisionReview: { mode: "full" },
    triage: { summary: "Fix", clusters: [], conflicts: [], unresolvedQuestions: [] },
    readiness: { status: "blocked", sourceReadiness: { status: "blocked", blockingFindingIds: [], unresolvedUserQuestions: [], summary: "Blocked" }, recommendedNextAction: "revise-design", blockingFindingIds: [], blockingConflictIds: [], blockingQuestionIds: [], summary: "Blocked" },
    requestedAt: "2026-05-11T00:00:00.000Z",
  };
}

test("adapter persists successful structured output", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-revision-adapter-"));
  const layout = await createWorkflowLayout(root, "demo-topic");
  const output = { revisedDesignMarkdown: validMarkdown, changeSummary: ["fixed"], resolvedItemIds: ["cluster-1"], unresolvedItemIds: [], assumptions: [], riskNotes: [] };
  const result = await runDesignReviserAdapter({
    layout,
    request: request(),
    sourceDesignMarkdown: validMarkdown,
    knownItemIds: new Set(["cluster-1", "q-1"]),
    options: {
      projectRoot: root,
      model: "test:model",
      runAgent: async <TOutput>(): Promise<AgentRunResult<TOutput>> => ({ agentRunId: "agent-1", role: "design-reviser", status: "succeeded", output: output as TOutput, paths: { agentRunDir: "agent" }, startedAt: "t", completedAt: "t", attempts: 1, attemptRecords: [], outputCapture: emptyOutputCaptureSummary() }),
    },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(JSON.parse(await fs.readFile(path.join(layout.workflowDir, "revisions/design/rev-1/output.json"), "utf8")).resolvedItemIds[0], "cluster-1");
});

test("adapter fails without design mutation when child fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-revision-adapter-"));
  const layout = await createWorkflowLayout(root, "demo-topic");
  const result = await runDesignReviserAdapter({
    layout,
    request: request(),
    sourceDesignMarkdown: validMarkdown,
    options: {
      projectRoot: root,
      model: "test:model",
      runAgent: async () => createFailedAgentRunResult({ agentRunId: "agent-1", role: "design-reviser", status: "timed-out", startedAt: "t", paths: { agentRunDir: "agent" }, error: { kind: "timeout", message: "timeout", retryable: true } }),
    },
  });
  assert.equal(result.status, "failed");
  await assert.rejects(() => fs.access(path.join(layout.topicDir, "design.md")));
});

test("validator rejects malformed directives, missing headings, unknown IDs, and requirements substitution", () => {
  assert.equal(validateRevisedDesignOutput({ revisedDesignMarkdown: "# Design", changeSummary: [], resolvedItemIds: [], unresolvedItemIds: [], assumptions: [], riskNotes: [], approveDesign: true }, new Set()).status, "failed");
  assert.equal(validateRevisedDesignOutput({ revisedDesignMarkdown: "# Design", changeSummary: [], resolvedItemIds: [], unresolvedItemIds: [], assumptions: [], riskNotes: [] }, new Set()).status, "failed");
  assert.equal(validateRevisedDesignOutput({ revisedDesignMarkdown: validMarkdown, changeSummary: [], resolvedItemIds: ["missing"], unresolvedItemIds: [], assumptions: [], riskNotes: [] }, new Set(["known"])).status, "failed");
  assert.equal(validateRevisedDesignOutput({ revisedDesignMarkdown: `${validMarkdown}\n\n## Tasks\n- do it`, changeSummary: [], resolvedItemIds: [], unresolvedItemIds: [], assumptions: [], riskNotes: [] }, new Set()).status, "failed");
});
