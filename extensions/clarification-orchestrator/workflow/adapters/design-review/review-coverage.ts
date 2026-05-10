import type { DesignReviewCoverage, DesignReviewerResult } from "./types.ts";
import { FULL_DESIGN_REVIEWER_ORDER, type FullDesignReviewerRole } from "./full-reviewer-registry.ts";

export function createInitialDesignReviewCoverage(selectedReviewerRoles: readonly FullDesignReviewerRole[]): DesignReviewCoverage {
  const selected = normalizeRoles(selectedReviewerRoles);
  const selectedSet = new Set(selected);
  return {
    availableReviewers: [...FULL_DESIGN_REVIEWER_ORDER],
    selectedReviewers: selected,
    unselectedReviewers: FULL_DESIGN_REVIEWER_ORDER.filter((role) => !selectedSet.has(role)),
    succeededReviewers: [],
    failedReviewers: [],
    pendingRetryReviewers: [],
  };
}

export function computeDesignReviewCoverage(input: {
  selectedReviewerRoles: readonly FullDesignReviewerRole[];
  reviewerResults: readonly DesignReviewerResult[];
  pendingRetryReviewers?: readonly FullDesignReviewerRole[];
}): DesignReviewCoverage {
  const selected = normalizeRoles(input.selectedReviewerRoles);
  const selectedSet = new Set(selected);
  const succeeded = new Set<FullDesignReviewerRole>();
  const failed = new Set<FullDesignReviewerRole>();
  for (const result of input.reviewerResults) {
    assertSelectedRole(selectedSet, result.reviewerRole);
    if (result.status === "succeeded") succeeded.add(result.reviewerRole as FullDesignReviewerRole);
    else failed.add(result.reviewerRole as FullDesignReviewerRole);
  }
  const pendingRetry = new Set<FullDesignReviewerRole>(input.pendingRetryReviewers ?? input.reviewerResults.filter((result) => result.status === "failed").map((result) => result.reviewerRole as FullDesignReviewerRole));
  for (const role of pendingRetry) assertSelectedRole(selectedSet, role);
  return {
    availableReviewers: [...FULL_DESIGN_REVIEWER_ORDER],
    selectedReviewers: selected,
    unselectedReviewers: FULL_DESIGN_REVIEWER_ORDER.filter((role) => !selectedSet.has(role)),
    succeededReviewers: selected.filter((role) => succeeded.has(role)),
    failedReviewers: selected.filter((role) => failed.has(role)),
    pendingRetryReviewers: selected.filter((role) => pendingRetry.has(role)),
  };
}

export function assertCoverageConsistent(coverage: DesignReviewCoverage): void {
  const selectedSet = new Set(coverage.selectedReviewers);
  const unselectedSet = new Set(coverage.unselectedReviewers);
  if (coverage.availableReviewers.length !== FULL_DESIGN_REVIEWER_ORDER.length) throw new Error("Coverage must list all available reviewers.");
  for (const role of FULL_DESIGN_REVIEWER_ORDER) {
    if (!selectedSet.has(role) && !unselectedSet.has(role)) throw new Error(`Coverage is missing role: ${role}`);
    if (selectedSet.has(role) && unselectedSet.has(role)) throw new Error(`Coverage marks role as both selected and unselected: ${role}`);
  }
  for (const role of [...coverage.succeededReviewers, ...coverage.failedReviewers, ...coverage.pendingRetryReviewers]) {
    if (!selectedSet.has(role)) throw new Error(`Coverage cannot track out-of-selection role: ${role}`);
  }
}

function normalizeRoles(roles: readonly FullDesignReviewerRole[]): FullDesignReviewerRole[] {
  const seen = new Set<FullDesignReviewerRole>();
  const normalized: FullDesignReviewerRole[] = [];
  for (const role of roles) {
    if (seen.has(role)) throw new Error(`Duplicate selected reviewer role: ${role}`);
    seen.add(role);
    normalized.push(role);
  }
  if (normalized.length === 0) throw new Error("At least one full design reviewer role must be selected.");
  return FULL_DESIGN_REVIEWER_ORDER.filter((role) => seen.has(role));
}

function assertSelectedRole(selectedSet: Set<FullDesignReviewerRole>, role: string): void {
  if (!selectedSet.has(role as FullDesignReviewerRole)) throw new Error(`Coverage cannot mark unselected reviewer role as selected result: ${role}`);
}
