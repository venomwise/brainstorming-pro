import path from "node:path";
import { appendWorkflowEvent } from "../../events.ts";
import type { WorkflowLayout } from "../../artifact-store.ts";
import type { WorkflowState } from "../../types.ts";
import { bindDesignArtifactForReview } from "./artifact-binding.ts";
import { readAggregatedFindings, readCoverage, readReadiness, readReviewerResults, validateReviewLedgerConsistency, writeAcceptIncompleteDecision } from "./review-run-store.ts";
import type { AcceptIncompleteDesignReviewDecision, DesignReviewRun } from "./types.ts";

export async function acceptIncompleteDesignReview(input: {
  layout: WorkflowLayout;
  state: WorkflowState;
  reviewRun: DesignReviewRun;
  confirmedByUser: boolean;
  decidedBy: string;
  reason?: string;
  decidedAt?: string;
}): Promise<{ decision: AcceptIncompleteDesignReviewDecision; nextPhase: "awaiting-design-approval" }> {
  if (!input.confirmedByUser) throw new Error("Accept incomplete design review requires explicit user confirmation.");
  if (input.reviewRun.mode !== "full") throw new Error("Only full design review can be accepted as incomplete.");
  const decisionRef = input.state.reviewDecisions.design;
  if (!decisionRef) throw new Error("Design review decision is missing.");
  const artifact = await bindDesignArtifactForReview(input.layout, input.state, decisionRef);
  if (artifact.ref.checksum !== input.reviewRun.designRef.checksum || artifact.ref.version !== input.reviewRun.designRef.version || artifact.ref.path !== input.reviewRun.designRef.path) {
    throw new Error("Cannot accept incomplete review for a stale design artifact.");
  }
  await validateReviewLedgerConsistency(input.layout, input.reviewRun);
  const coverage = await readCoverage(input.layout, input.reviewRun);
  const aggregate = await readAggregatedFindings(input.layout, input.reviewRun);
  const readiness = await readReadiness(input.layout, input.reviewRun);
  const results = await readReviewerResults(input.layout, input.reviewRun);
  if (readiness.status !== "incomplete-review" || aggregate.status !== "partial") throw new Error("Only incomplete partial design reviews can be accepted.");
  if (coverage.succeededReviewers.length === 0 || coverage.failedReviewers.length === 0) throw new Error("Incomplete review acceptance requires at least one success and one failure.");
  if (aggregate.findings.some((finding) => finding.severity === "blocking") || aggregate.counts.blocking > 0) throw new Error("Incomplete review with blocking findings cannot be accepted.");
  const decision: AcceptIncompleteDesignReviewDecision = {
    decisionId: `accept-incomplete-${Date.now()}`,
    reviewRunId: input.reviewRun.reviewRunId,
    designRef: artifact.ref,
    acceptedCoverage: coverage,
    successfulResultRefs: coverage.succeededReviewers.map((role) => path.join(input.reviewRun.ledgerPath, "reviewer-results", `${role}.json`)),
    failedDiagnosticRefs: coverage.failedReviewers.map((role) => path.join(input.reviewRun.ledgerPath, "reviewer-results", `${role}.json`)),
    aggregateRef: path.join(input.reviewRun.ledgerPath, "aggregated-findings.json"),
    decidedBy: "user",
    reason: input.reason,
    decidedAt: input.decidedAt ?? new Date().toISOString(),
  };
  for (const role of coverage.succeededReviewers) {
    if (!results.find((result) => result.reviewerRole === role && result.status === "succeeded")) throw new Error(`Missing successful reviewer result for ${role}.`);
  }
  for (const role of coverage.failedReviewers) {
    if (!results.find((result) => result.reviewerRole === role && result.status === "failed")) throw new Error(`Missing failed reviewer diagnostic for ${role}.`);
  }
  await writeAcceptIncompleteDecision(input.layout, input.reviewRun, decision);
  await appendWorkflowEvent(input.layout, { type: "design-review-incomplete-accepted", phase: "design-review", details: { decisionId: decision.decisionId, reviewRunId: input.reviewRun.reviewRunId, designRef: artifact.ref, acceptedCoverage: coverage, acceptedAt: decision.decidedAt } });
  return { decision, nextPhase: "awaiting-design-approval" };
}
