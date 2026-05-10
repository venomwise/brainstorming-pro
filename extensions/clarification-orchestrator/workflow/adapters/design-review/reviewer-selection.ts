import type { ReviewDecisionRef, VersionedArtifactRef } from "../../types.ts";
import { FULL_DESIGN_REVIEWER_ORDER, isFullDesignReviewerRole, resolveFullDesignReviewerSet, type FullDesignReviewerRole } from "./full-reviewer-registry.ts";

export type ResolvedDesignReviewerSelection = {
  designRef: VersionedArtifactRef;
  selectedReviewerRoles: FullDesignReviewerRole[];
  unselectedReviewerRoles: FullDesignReviewerRole[];
  selectionReason?: string;
};

export function resolveDesignReviewerSelection(decision: ReviewDecisionRef, designRef: VersionedArtifactRef): ResolvedDesignReviewerSelection {
  validateDesignReviewerSelection(decision, designRef);
  const requested = decision.mode === "full" && decision.target === "design" ? decision.selectedReviewerRoles : undefined;
  const resolvedRoles = resolveFullDesignReviewerSet(requested).map((reviewer) => reviewer.role);
  const resolvedSet = new Set(resolvedRoles);
  const selectedReviewerRoles = FULL_DESIGN_REVIEWER_ORDER.filter((role) => resolvedSet.has(role));
  const selected = new Set(selectedReviewerRoles);
  return {
    designRef,
    selectedReviewerRoles,
    unselectedReviewerRoles: FULL_DESIGN_REVIEWER_ORDER.filter((role) => !selected.has(role)),
    selectionReason: decision.mode === "full" && decision.target === "design" ? decision.selectionReason : undefined,
  };
}

export function validateDesignReviewerSelection(decision: ReviewDecisionRef, designRef: VersionedArtifactRef): void {
  if (decision.target !== "design" || decision.mode !== "full") throw new Error("Reviewer selection is only valid for full design review decisions.");
  if (decision.artifacts.length !== 1 || decision.artifacts[0]?.kind !== "design") throw new Error("Full design review selection must reference exactly one design artifact.");
  const bound = decision.artifacts[0];
  if (bound.version !== designRef.version || bound.checksum !== designRef.checksum || bound.path !== designRef.path) {
    throw new Error("Full design review selection is stale for the current design artifact.");
  }
  if (decision.selectedReviewerRoles === undefined) {
    resolveFullDesignReviewerSet(undefined);
    return;
  }
  if (decision.selectedReviewerRoles.length === 0) throw new Error("At least one full design reviewer role must be selected.");
  const seen = new Set<FullDesignReviewerRole>();
  for (const role of decision.selectedReviewerRoles as readonly unknown[]) {
    if (role === "minimal-reviewer") throw new Error("minimal-reviewer is not allowed in full design review selection.");
    if (typeof role !== "string" || !isFullDesignReviewerRole(role)) throw new Error(`Unknown full design reviewer role: ${String(role)}`);
    if (seen.has(role)) throw new Error(`Duplicate full design reviewer role selected: ${role}`);
    seen.add(role);
  }
  resolveFullDesignReviewerSet(decision.selectedReviewerRoles);
}
