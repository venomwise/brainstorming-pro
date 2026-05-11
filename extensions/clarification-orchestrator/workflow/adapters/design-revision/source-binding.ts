import fs from "node:fs/promises";

import type { WorkflowLayout } from "../../artifact-store.ts";
import { checksum, resolveWorkflowPath } from "../../artifact-store.ts";
import { readAggregatedFindings, readCoverage, readDesignReviewRun, readReadiness, readTriageReport } from "../design-review/review-run-store.ts";
import type { DesignReviewCoverage, DesignReviewRun, DesignReviewTriageReport } from "../design-review/types.ts";
import type { DesignRevisionAuthorization } from "./types.ts";

export type BoundDesignRevisionSources = {
  designContent: string;
  reviewRun: DesignReviewRun;
  triage: DesignReviewTriageReport;
  readiness: Awaited<ReturnType<typeof readReadiness>>;
  coverage?: DesignReviewCoverage;
};

export async function bindDesignRevisionSources(layout: WorkflowLayout, authorization: DesignRevisionAuthorization, runHint?: DesignReviewRun): Promise<BoundDesignRevisionSources> {
  const reviewRun = await loadReviewRun(layout, authorization, runHint);
  assertSameDesignRef(reviewRun.designRef, authorization.sourceDesignRef, "authorization source design");

  const designContent = await fs.readFile(resolveWorkflowPath(layout, authorization.sourceDesignRef.path), "utf8");
  if (checksum(designContent) !== authorization.sourceDesignRef.checksum) throw new Error("Design revision source design checksum mismatch.");

  const aggregate = await readAggregatedFindings(layout, reviewRun);
  assertSameDesignRef(aggregate.designRef, authorization.sourceDesignRef, "aggregate design");

  const readiness = await readReadiness(layout, reviewRun);
  const readinessContent = await fs.readFile(resolveWorkflowPath(layout, authorization.sourceReadinessRef.path), "utf8");
  if (checksum(readinessContent) !== authorization.sourceReadinessRef.checksum) throw new Error("Design revision readiness checksum mismatch.");
  if (readiness.status !== aggregate.readiness.status) throw new Error("Design revision readiness does not match review aggregate.");

  const triage = await readTriageReport(layout, reviewRun);
  const triageContent = await fs.readFile(resolveWorkflowPath(layout, authorization.sourceTriageRef.path), "utf8");
  if (checksum(triageContent) !== authorization.sourceTriageRef.checksum) throw new Error("Design revision triage checksum mismatch.");
  assertTriageBoundToDesign(triage, authorization.sourceDesignRef);

  const coverage = authorization.sourceCoverageRef ? await readCoverage(layout, reviewRun) : undefined;
  if (authorization.sourceCoverageRef) {
    const coverageContent = await fs.readFile(resolveWorkflowPath(layout, authorization.sourceCoverageRef.path), "utf8");
    if (checksum(coverageContent) !== authorization.sourceCoverageRef.checksum) throw new Error("Design revision coverage checksum mismatch.");
  }

  return { designContent, reviewRun, triage, readiness, ...(coverage ? { coverage } : {}) };
}

export async function assertLatestDesignBinding(layout: WorkflowLayout, sourceDesignRef: DesignRevisionAuthorization["sourceDesignRef"]): Promise<void> {
  const content = await fs.readFile(resolveWorkflowPath(layout, sourceDesignRef.path), "utf8");
  if (checksum(content) !== sourceDesignRef.checksum) throw new Error("Design revision latest design checksum mismatch.");
  const mirrorContent = await fs.readFile(resolveWorkflowPath(layout, "design.md"), "utf8");
  if (checksum(mirrorContent) !== sourceDesignRef.checksum) throw new Error("Design revision source design is stale relative to latest design mirror.");
}

export function assertTriageBoundToDesign(triage: DesignReviewTriageReport, sourceDesignRef: DesignRevisionAuthorization["sourceDesignRef"]): void {
  assertSameDesignRef(triage.designRef, sourceDesignRef, "triage design");
  assertSameDesignRef(triage.sources.designRef, sourceDesignRef, "triage source design");
  if (triage.sources.reviewRunId !== triage.reviewRunId) throw new Error("Design revision triage source review run mismatch.");
  for (const finding of triage.findings) assertSameDesignRef(finding.designRef, sourceDesignRef, `triage finding ${finding.id}`);
}

export function assertSameDesignRef(left: DesignRevisionAuthorization["sourceDesignRef"], right: DesignRevisionAuthorization["sourceDesignRef"], label: string): void {
  if (left.kind !== "design" || right.kind !== "design") throw new Error(`${label} must reference design artifacts.`);
  if (left.version !== right.version || left.path !== right.path || left.checksum !== right.checksum) throw new Error(`Design revision ${label} ref mismatch.`);
}

async function loadReviewRun(layout: WorkflowLayout, authorization: DesignRevisionAuthorization, runHint?: DesignReviewRun): Promise<DesignReviewRun> {
  if (runHint) {
    if (runHint.reviewRunId !== authorization.sourceReviewRunId) throw new Error("Design revision review run id mismatch.");
    return await readDesignReviewRun(layout, runHint);
  }
  const ledgerPath = `.workflow/reviews/design/${authorization.sourceReviewRunId}`;
  return await readDesignReviewRun(layout, {
    reviewRunId: authorization.sourceReviewRunId,
    topic: authorization.topic,
    workflowRunId: authorization.workflowRunId,
    mode: authorization.postRevisionReview.mode,
    status: "created",
    designRef: authorization.sourceDesignRef,
    reviewDecisionRef: "unknown",
    ledgerPath,
    startedAt: authorization.authorizedAt,
    reviewerResults: [],
  });
}
