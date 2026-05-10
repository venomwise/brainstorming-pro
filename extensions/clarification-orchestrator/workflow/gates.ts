import fs from "node:fs/promises";
import path from "node:path";
import type { WorkflowLayout } from "./artifact-store.ts";
import { assertWorkflowPath, checksum, resolveWorkflowPath } from "./artifact-store.ts";
import type { ApprovalRef, FullDesignReviewerRole, ReviewDecisionRef, ReviewMode, ReviewTarget, VersionedArtifactRef } from "./types.ts";

export type RecordReviewDecisionInput = {
  target: ReviewTarget;
  mode: ReviewMode;
  artifacts: VersionedArtifactRef[];
  selectedBy: string;
  selectedAt?: string;
  selectedReviewerRoles?: FullDesignReviewerRole[];
  selectionReason?: string;
};

export async function validateReviewDecision(
  layout: WorkflowLayout,
  decision: Pick<ReviewDecisionRef, "artifacts"> & Partial<Pick<ReviewDecisionRef, "target" | "mode" | "selectedReviewerRoles" | "selectionReason">>,
): Promise<void> {
  validateReviewDecisionSelection(decision);
  await validateRefs(layout, decision.artifacts);
}

export async function recordReviewDecision(layout: WorkflowLayout, input: RecordReviewDecisionInput): Promise<ReviewDecisionRef> {
  const selectedAt = input.selectedAt ?? new Date().toISOString();
  await validateReviewDecision(layout, input);
  const id = `${input.target}-${selectedAt.replace(/[:.]/gu, "-")}`;
  const decisionPath = path.join(layout.decisionsDir, `${id}.json`);
  assertWorkflowPath(layout, decisionPath);
  const base = { id, target: input.target, mode: input.mode, artifacts: input.artifacts, selectedBy: input.selectedBy, selectedAt, path: path.relative(layout.topicDir, decisionPath) };
  const ref: ReviewDecisionRef = input.target === "design" && input.mode === "full"
    ? { ...base, target: "design", mode: "full", selectedReviewerRoles: input.selectedReviewerRoles, selectionReason: input.selectionReason }
    : base;
  await fs.writeFile(decisionPath, `${JSON.stringify(ref, null, 2)}\n`, { flag: "wx" });
  return ref;
}

export async function validateDesignApproval(layout: WorkflowLayout, approval: Pick<ApprovalRef, "artifacts">): Promise<void> {
  if (approval.artifacts.length !== 1 || approval.artifacts[0]?.kind !== "design") throw new Error("Design approval must reference exactly the current design artifact.");
  await validateRefs(layout, approval.artifacts);
}

export async function validatePlanApproval(layout: WorkflowLayout, approval: Pick<ApprovalRef, "artifacts">): Promise<void> {
  const kinds = approval.artifacts.map((artifact) => artifact.kind).sort();
  if (kinds.join(",") !== "requirements,tasks") throw new Error("Plan approval must reference current requirements and tasks artifacts.");
  await validateRefs(layout, approval.artifacts);
}

export async function approveGate(layout: WorkflowLayout, input: { gate: "design" | "plan"; artifacts: VersionedArtifactRef[]; approvedBy: string; approvedAt?: string }): Promise<ApprovalRef> {
  const approval: ApprovalRef = {
    gate: input.gate,
    artifacts: input.artifacts,
    approvedBy: input.approvedBy,
    approvedAt: input.approvedAt ?? new Date().toISOString(),
    path: path.relative(layout.topicDir, path.join(layout.approvalsDir, `${input.gate}-approval.json`)),
  };
  if (input.gate === "design") await validateDesignApproval(layout, approval);
  else await validatePlanApproval(layout, approval);
  const approvalPath = resolveWorkflowPath(layout, approval.path);
  await fs.writeFile(approvalPath, `${JSON.stringify(approval, null, 2)}\n`);
  return approval;
}

async function validateRefs(layout: WorkflowLayout, refs: VersionedArtifactRef[]): Promise<void> {
  if (refs.length === 0) throw new Error("At least one artifact reference is required.");
  for (const ref of refs) {
    if (ref.version < 1) throw new Error(`Invalid artifact version for ${ref.kind}.`);
    const artifactPath = resolveWorkflowPath(layout, ref.path);
    const expectedSuffix = path.join(".workflow", "artifacts", ref.kind, `v${ref.version}.md`);
    if (!artifactPath.endsWith(expectedSuffix)) throw new Error(`Artifact reference does not match expected version path for ${ref.kind} v${ref.version}.`);
    const content = await fs.readFile(artifactPath, "utf8");
    if (!content.length) throw new Error(`Artifact ${ref.kind} v${ref.version} is empty.`);
    if (checksum(content) !== ref.checksum) throw new Error(`Artifact ${ref.kind} v${ref.version} checksum mismatch.`);
  }
}

const fullDesignReviewerRoles = new Set<string>([
  "product-reviewer",
  "architecture-reviewer",
  "risk-security-reviewer",
  "testing-reviewer",
  "scope-simplicity-reviewer",
]);

function isFullDesignReviewerRole(value: unknown): value is FullDesignReviewerRole {
  return typeof value === "string" && fullDesignReviewerRoles.has(value);
}

function validateReviewDecisionSelection(
  decision: Partial<Pick<ReviewDecisionRef, "target" | "mode" | "selectedReviewerRoles" | "selectionReason">>,
): void {
  if (decision.target !== "design") {
    if (decision.selectedReviewerRoles !== undefined) throw new Error("Full reviewer selection is only allowed for design review decisions.");
    if (decision.selectionReason !== undefined) throw new Error("Selection reason is only allowed for design review decisions.");
    return;
  }
  if (decision.mode !== "full") {
    if (decision.selectedReviewerRoles !== undefined) throw new Error("Full reviewer selection is only allowed for full design review decisions.");
    if (decision.selectionReason !== undefined) throw new Error("Selection reason is only allowed for full design review decisions.");
    return;
  }
  if (decision.selectedReviewerRoles === undefined) return;
  if (decision.selectedReviewerRoles.length === 0) throw new Error("At least one full design reviewer role must be selected.");
  const seen = new Set<FullDesignReviewerRole>();
  for (const role of decision.selectedReviewerRoles as readonly unknown[]) {
    if (role === "minimal-reviewer") throw new Error("minimal-reviewer is not allowed in full design review selection.");
    if (!isFullDesignReviewerRole(role)) throw new Error(`Unknown full design reviewer role: ${String(role)}`);
    if (seen.has(role)) throw new Error(`Duplicate full design reviewer role selected: ${role}`);
    seen.add(role);
  }
}
