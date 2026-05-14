import type { ReviewMode, VersionedArtifactRef } from "./types.ts";

export type ReviewPanelSummaryDiagnosticLevel = "info" | "warning" | "error";

export type ReviewPanelSummaryDiagnostic = {
  level: ReviewPanelSummaryDiagnosticLevel;
  code: string;
  message: string;
  at?: string;
  details?: unknown;
};

export type ArtifactDisplayRef = {
  kind: VersionedArtifactRef["kind"] | string;
  version?: number;
  path?: string;
  checksum?: string;
  label?: string;
  stale?: boolean;
};

export type LedgerLinkSummary = {
  label: string;
  path?: string;
  ref?: string;
  checksum?: string;
  stale?: boolean;
};

export type ReviewReadinessSummary = {
  status: string;
  evidence?: string[];
  ledgerLinks?: LedgerLinkSummary[];
  stale?: boolean;
  diagnostics?: ReviewPanelSummaryDiagnostic[];
};

export type ReviewerFindingCountsSummary = {
  mustFix?: number;
  shouldFix?: number;
  notes?: number;
  blockers?: number;
  total?: number;
};

export type ReviewerCoverageSummary = {
  reviewerId: string;
  label?: string;
  selected?: boolean;
  status: string;
  findingCounts?: ReviewerFindingCountsSummary;
  outputPath?: string;
  ledgerLinks?: LedgerLinkSummary[];
  stale?: boolean;
  diagnostics?: ReviewPanelSummaryDiagnostic[];
};

export type FindingClusterSummary = {
  id: string;
  title?: string;
  description: string;
  sourceReviewerIds?: string[];
  sourceFindingIds?: string[];
  affectedSections?: string[];
  ledgerLinks?: LedgerLinkSummary[];
};

export type TriageTierSummary = {
  mustFix: FindingClusterSummary[];
  shouldFix: FindingClusterSummary[];
  notes: FindingClusterSummary[];
};

export type ConflictSummary = {
  id: string;
  category: string;
  description: string;
  involvedReviewerIds?: string[];
  involvedFindingIds?: string[];
  consequence?: string;
  ledgerLinks?: LedgerLinkSummary[];
};

export type UnresolvedQuestionSummary = {
  id: string;
  prompt: string;
  blocking: boolean;
  sourceContext?: string;
  sourceReviewerIds?: string[];
  sourceFindingIds?: string[];
};

export type DesignReviewSummary = {
  reviewRunId?: string;
  mode: ReviewMode | string;
  status: string;
  designRef?: ArtifactDisplayRef;
  coverage: ReviewerCoverageSummary[];
  triage?: TriageTierSummary;
  conflicts?: ConflictSummary[];
  unresolvedQuestions?: UnresolvedQuestionSummary[];
  readiness?: ReviewReadinessSummary;
  ledgerLinks?: LedgerLinkSummary[];
  partial?: boolean;
  incomplete?: boolean;
  stale?: boolean;
  diagnostics?: ReviewPanelSummaryDiagnostic[];
};

export type DesignRevisionSummary = {
  currentDesignRef?: ArtifactDisplayRef;
  latestRevision?: {
    revisionId: string;
    sourceDesignRef?: ArtifactDisplayRef;
    revisedDesignRef?: ArtifactDisplayRef;
    sourceReviewRunId?: string;
    sourceTriageLink?: LedgerLinkSummary;
    status: string;
    postRevisionReviewRunId?: string;
  };
  staleEvidence?: StaleEvidenceSummary[];
  diagnostics?: ReviewPanelSummaryDiagnostic[];
};

export type PlanRevisionSummary = {
  attemptNumber: number;
  maxAttempts: number;
  status: string;
  sourceRequirementsRef?: ArtifactDisplayRef;
  sourceTasksRef?: ArtifactDisplayRef;
  revisedRequirementsRef?: ArtifactDisplayRef;
  revisedTasksRef?: ArtifactDisplayRef;
  reason?: string;
  postRevisionReviewRunId?: string;
  blockersRemaining?: boolean;
  diagnostics?: ReviewPanelSummaryDiagnostic[];
};

export type PlanReviewSummary = {
  reviewRunId?: string;
  status: string;
  approvedDesignRef?: ArtifactDisplayRef;
  requirementsRef?: ArtifactDisplayRef;
  tasksRef?: ArtifactDisplayRef;
  readiness?: ReviewReadinessSummary;
  reviewers: ReviewerCoverageSummary[];
  ledgerLinks?: LedgerLinkSummary[];
  automaticRevision?: PlanRevisionSummary;
  stale?: boolean;
  diagnostics?: ReviewPanelSummaryDiagnostic[];
};

export type StaleEvidenceKind = "design-review" | "design-triage" | "design-readiness" | "design-revision" | "plan-review" | "plan-readiness" | "plan-revision";

export type StaleEvidenceSummary = {
  kind: StaleEvidenceKind;
  ref?: LedgerLinkSummary;
  reason: string;
  currentArtifactRefs?: ArtifactDisplayRef[];
  staleArtifactRefs?: ArtifactDisplayRef[];
  checksumMismatch?: boolean;
  artifactMismatch?: boolean;
  provenanceOnly: true;
  diagnostics?: ReviewPanelSummaryDiagnostic[];
};

export type WorkflowReviewPanelSummary = {
  topic: string;
  runId: string;
  generatedAt: string;
  designReview?: DesignReviewSummary;
  designRevision?: DesignRevisionSummary;
  planReview?: PlanReviewSummary;
  staleEvidence: StaleEvidenceSummary[];
  diagnostics: ReviewPanelSummaryDiagnostic[];
};

export function createEmptyWorkflowReviewPanelSummary(input: { topic: string; runId: string; generatedAt?: string; diagnostics?: ReviewPanelSummaryDiagnostic[] }): WorkflowReviewPanelSummary {
  return {
    topic: input.topic,
    runId: input.runId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    staleEvidence: [],
    diagnostics: input.diagnostics ?? [normalizeReviewPanelDiagnostic({ level: "info", code: "review-panel-empty", message: "Review panel detail is not available for the current workflow state." })],
  };
}

export function normalizeReviewPanelDiagnostic(input: Partial<ReviewPanelSummaryDiagnostic> & { message: string }): ReviewPanelSummaryDiagnostic {
  return {
    level: input.level ?? "warning",
    code: input.code ?? "review-panel-diagnostic",
    message: input.message,
    ...(input.at ? { at: input.at } : {}),
    ...(input.details === undefined ? {} : { details: input.details }),
  };
}

export function artifactDisplayRefFromVersionedArtifact(artifact: VersionedArtifactRef, options: { label?: string; stale?: boolean } = {}): ArtifactDisplayRef {
  return {
    kind: artifact.kind,
    version: artifact.version,
    path: artifact.path,
    checksum: artifact.checksum,
    ...(options.label ? { label: options.label } : {}),
    ...(options.stale === undefined ? {} : { stale: options.stale }),
  };
}

export function formatArtifactDisplayRef(ref: ArtifactDisplayRef | undefined): string {
  if (!ref) return "artifact unavailable";
  const version = ref.version === undefined ? "" : ` v${ref.version}`;
  const checksum = ref.checksum ? `@${ref.checksum.slice(0, 12)}` : "";
  const path = ref.path ? ` ${ref.path}` : "";
  const stale = ref.stale ? " stale" : "";
  return `${ref.label ?? ref.kind}${version}${checksum}${stale}${path}`.trim();
}

export function ledgerLinkSummary(label: string, pathOrRef?: string, options: { checksum?: string; stale?: boolean } = {}): LedgerLinkSummary {
  return {
    label,
    ...(pathOrRef ? (pathOrRef.includes("/") || pathOrRef.endsWith(".json") ? { path: pathOrRef } : { ref: pathOrRef }) : {}),
    ...(options.checksum ? { checksum: options.checksum } : {}),
    ...(options.stale === undefined ? {} : { stale: options.stale }),
  };
}
