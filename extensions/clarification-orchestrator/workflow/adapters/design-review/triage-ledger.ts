import fs from "node:fs/promises";
import path from "node:path";
import type { WorkflowLayout } from "../../artifact-store.ts";
import { checksum } from "../../artifact-store.ts";
import { buildDesignReviewTriageReport } from "./triage.ts";
import { writeTriageReport } from "./review-run-store.ts";
import type { DesignReviewAggregateResult, DesignReviewRun, DesignReviewTriageReport, DesignReviewerResult } from "./types.ts";

export async function buildAndWriteDesignReviewTriage(input: {
  layout: WorkflowLayout;
  run: DesignReviewRun;
  aggregate: DesignReviewAggregateResult;
  reviewerResults: readonly DesignReviewerResult[];
}): Promise<DesignReviewTriageReport> {
  const sources = {
    reviewRunId: input.run.reviewRunId,
    designRef: input.run.designRef,
    aggregate: await checksumRef(input.layout, input.run, "aggregated-findings.json"),
    ...(input.aggregate.coverage ? { coverage: await checksumRef(input.layout, input.run, "coverage.json") } : {}),
    reviewerResults: await Promise.all(input.reviewerResults.map(async (result) => ({
      reviewerRole: result.reviewerRole,
      path: path.join(input.run.ledgerPath, "reviewer-results", `${result.reviewerRole}.json`),
      checksum: checksum(await fs.readFile(path.join(input.layout.topicDir, input.run.ledgerPath, "reviewer-results", `${result.reviewerRole}.json`), "utf8")),
      status: result.status,
    }))),
    reviewDecisionRef: input.run.reviewDecisionRef,
  };
  const report = buildDesignReviewTriageReport({ reviewRun: input.run, aggregate: input.aggregate, findings: input.aggregate.findings, coverage: input.aggregate.coverage, currentReadiness: input.aggregate.readiness, sources });
  return await writeTriageReport(input.layout, input.run, report);
}

async function checksumRef(layout: WorkflowLayout, run: DesignReviewRun, fileName: string): Promise<{ path: string; checksum: string }> {
  const filePath = path.join(layout.topicDir, run.ledgerPath, fileName);
  const content = await fs.readFile(filePath, "utf8");
  return { path: path.join(run.ledgerPath, fileName), checksum: checksum(content) };
}
