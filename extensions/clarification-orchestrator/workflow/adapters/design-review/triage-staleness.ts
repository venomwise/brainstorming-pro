import fs from "node:fs/promises";
import type { WorkflowLayout } from "../../artifact-store.ts";
import { checksum, resolveWorkflowPath } from "../../artifact-store.ts";
import type { DesignReviewRun, DesignReviewTriageReport } from "./types.ts";
import { readTriageReport } from "./review-run-store.ts";

export async function isDesignReviewTriageStale(layout: WorkflowLayout, run: DesignReviewRun, report: DesignReviewTriageReport): Promise<boolean> {
  try {
    const currentDesign = await fs.readFile(resolveWorkflowPath(layout, run.designRef.path), "utf8");
    if (checksum(currentDesign) !== run.designRef.checksum) return true;
    const aggregateContent = await fs.readFile(resolveWorkflowPath(layout, report.sources.aggregate.path), "utf8");
    if (checksum(aggregateContent) !== report.sources.aggregate.checksum) return true;
    if (report.sources.coverage) {
      const coverageContent = await fs.readFile(resolveWorkflowPath(layout, report.sources.coverage.path), "utf8");
      if (checksum(coverageContent) !== report.sources.coverage.checksum) return true;
    }
    for (const result of report.sources.reviewerResults) {
      const content = await fs.readFile(resolveWorkflowPath(layout, result.path), "utf8");
      if (checksum(content) !== result.checksum) return true;
    }
    return false;
  } catch {
    return true;
  }
}

export async function assertFreshDesignReviewTriage(layout: WorkflowLayout, run: DesignReviewRun): Promise<DesignReviewTriageReport> {
  const report = await readTriageReport(layout, run);
  if (await isDesignReviewTriageStale(layout, run, report)) throw new Error("Design review triage is stale.");
  return report;
}

