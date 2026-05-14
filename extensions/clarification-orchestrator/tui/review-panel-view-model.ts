import type { WorkflowLiveSnapshot } from "../workflow/progress-types.ts";
import type { ArtifactDisplayRef, ConflictSummary, DesignReviewSummary, DesignRevisionSummary, FindingClusterSummary, LedgerLinkSummary, PlanReviewSummary, ReviewPanelSummaryDiagnostic, ReviewReadinessSummary, ReviewerCoverageSummary, StaleEvidenceSummary, TriageTierSummary, UnresolvedQuestionSummary, WorkflowReviewPanelSummary } from "../workflow/review-panel-summary.ts";
import type { WorkflowPhase } from "../workflow/types.ts";

export type ReviewPanelDiagnostic = ReviewPanelSummaryDiagnostic;
export type LedgerLinkViewModel = LedgerLinkSummary;
export type FindingClusterViewModel = FindingClusterSummary;
export type ConflictViewModel = ConflictSummary;
export type UnresolvedQuestionViewModel = UnresolvedQuestionSummary;
export type ReadinessViewModel = ReviewReadinessSummary;
export type StaleEvidenceViewModel = StaleEvidenceSummary;

export type ReviewerCoverageViewModel = ReviewerCoverageSummary & {
  liveStatusHint?: string;
};

export type TriageTierViewModel = TriageTierSummary;

export type DesignReviewPanelViewModel = Omit<DesignReviewSummary, "coverage" | "triage" | "conflicts" | "unresolvedQuestions" | "readiness" | "diagnostics"> & {
  coverage: ReviewerCoverageViewModel[];
  triage?: TriageTierViewModel;
  conflicts: ConflictViewModel[];
  unresolvedQuestions: UnresolvedQuestionViewModel[];
  readiness?: ReadinessViewModel;
  ledgerLinks: LedgerLinkViewModel[];
  diagnostics: ReviewPanelDiagnostic[];
};

export type DesignRevisionPanelViewModel = DesignRevisionSummary & {
  diagnostics: ReviewPanelDiagnostic[];
};

export type PlanReviewPanelViewModel = PlanReviewSummary & {
  reviewers: ReviewerCoverageViewModel[];
  ledgerLinks: LedgerLinkViewModel[];
  diagnostics: ReviewPanelDiagnostic[];
};

export type ReviewPanelViewModel = {
  topic: string;
  runId: string;
  phase: WorkflowPhase;
  designReview?: DesignReviewPanelViewModel;
  designRevision?: DesignRevisionPanelViewModel;
  planReview?: PlanReviewPanelViewModel;
  staleEvidence: StaleEvidenceViewModel[];
  diagnostics: ReviewPanelDiagnostic[];
};

export type ReviewPanelViewModelInput = {
  snapshot: WorkflowLiveSnapshot;
  summary?: WorkflowReviewPanelSummary;
};

export function buildReviewPanelViewModel(input: ReviewPanelViewModelInput): ReviewPanelViewModel {
  const diagnostics: ReviewPanelDiagnostic[] = [];
  const base: ReviewPanelViewModel = {
    topic: input.snapshot.topic,
    runId: input.snapshot.runId,
    phase: input.snapshot.phase,
    staleEvidence: [],
    diagnostics,
  };
  if (!input.summary) {
    diagnostics.push({ level: "warning", code: "review-panel-summary-unavailable", message: "Review panel detail unavailable; use /brainstorm-pro --status or /brainstorm-pro --resume for runtime-owned detail." });
    return base;
  }
  diagnostics.push(...input.summary.diagnostics);
  if (input.summary.topic !== input.snapshot.topic || input.summary.runId !== input.snapshot.runId) {
    diagnostics.push({ level: "error", code: "review-panel-context-mismatch", message: "Review panel summary topic or run id does not match the live snapshot; mismatched evidence is not presented as current." });
    return { ...base, staleEvidence: input.summary.staleEvidence, diagnostics };
  }
  const designReview = safeDesignReview(input.summary.designReview, input.snapshot, diagnostics);
  const designRevision = safeDesignRevision(input.summary.designRevision, diagnostics);
  const planReview = safePlanReview(input.summary.planReview, input.snapshot, diagnostics);
  return {
    ...base,
    ...(designReview ? { designReview } : {}),
    ...(designRevision ? { designRevision } : {}),
    ...(planReview ? { planReview } : {}),
    staleEvidence: input.summary.staleEvidence,
    diagnostics,
  };
}

function safeDesignReview(summary: DesignReviewSummary | undefined, snapshot: WorkflowLiveSnapshot, diagnostics: ReviewPanelDiagnostic[]): DesignReviewPanelViewModel | undefined {
  if (!summary) return undefined;
  if (!Array.isArray(summary.coverage)) {
    diagnostics.push({ level: "warning", code: "design-review-coverage-malformed", message: "Design review coverage is malformed and was omitted." });
    return undefined;
  }
  if (!summary.triage) diagnostics.push({ level: "warning", code: "triage-unavailable", message: "Design review triage is unavailable; renderer will not classify raw findings." });
  if (!summary.readiness) diagnostics.push({ level: "warning", code: "readiness-unavailable", message: "Design review readiness is unavailable and must not be inferred as approval eligibility." });
  return {
    ...summary,
    coverage: withLiveReviewerHints(summary.coverage, snapshot, "design"),
    conflicts: summary.conflicts ?? [],
    unresolvedQuestions: summary.unresolvedQuestions ?? [],
    ledgerLinks: summary.ledgerLinks ?? [],
    diagnostics: summary.diagnostics ?? [],
  };
}

function safeDesignRevision(summary: DesignRevisionSummary | undefined, diagnostics: ReviewPanelDiagnostic[]): DesignRevisionPanelViewModel | undefined {
  if (!summary) return undefined;
  if (summary.latestRevision && typeof summary.latestRevision.revisionId !== "string") {
    diagnostics.push({ level: "warning", code: "design-revision-malformed", message: "Design revision summary is malformed and was omitted." });
    return undefined;
  }
  return { ...summary, diagnostics: summary.diagnostics ?? [] };
}

function safePlanReview(summary: PlanReviewSummary | undefined, snapshot: WorkflowLiveSnapshot, diagnostics: ReviewPanelDiagnostic[]): PlanReviewPanelViewModel | undefined {
  if (!summary) return undefined;
  if (!Array.isArray(summary.reviewers)) {
    diagnostics.push({ level: "warning", code: "plan-review-reviewers-malformed", message: "Plan review reviewer coverage is malformed and was omitted." });
    return undefined;
  }
  const illegalControls = Object.keys(summary as unknown as Record<string, unknown>).filter((key) => ["mode", "reviewerSubset", "partialAccept", "retryControls", "controls"].includes(key));
  if (illegalControls.length) diagnostics.push({ level: "warning", code: "unsupported-plan-review-controls", message: `Unsupported plan review controls were ignored: ${illegalControls.join(", ")}` });
  if (!summary.readiness) diagnostics.push({ level: "warning", code: "plan-readiness-unavailable", message: "Plan review readiness is unavailable and is not plan approval." });
  return {
    ...summary,
    reviewers: withLiveReviewerHints(summary.reviewers, snapshot, "plan"),
    ledgerLinks: summary.ledgerLinks ?? [],
    diagnostics: summary.diagnostics ?? [],
  };
}

function withLiveReviewerHints(reviewers: ReviewerCoverageSummary[], snapshot: WorkflowLiveSnapshot, target: "design" | "plan"): ReviewerCoverageViewModel[] {
  return reviewers.map((reviewer) => {
    if (reviewer.status !== "running" && reviewer.status !== "started") return reviewer;
    const live = snapshot.reviewers.find((candidate) => candidate.target === target && candidate.reviewerId === reviewer.reviewerId);
    return live ? { ...reviewer, liveStatusHint: live.status } : reviewer;
  });
}

export function artifactLabel(ref: ArtifactDisplayRef | undefined): string {
  if (!ref) return "artifact unavailable";
  const version = ref.version === undefined ? "" : ` v${ref.version}`;
  const checksum = ref.checksum ? `@${ref.checksum.slice(0, 12)}` : "";
  const path = ref.path ? ` ${ref.path}` : "";
  return `${ref.label ?? ref.kind}${version}${checksum}${ref.stale ? " stale" : ""}${path}`.trim();
}
