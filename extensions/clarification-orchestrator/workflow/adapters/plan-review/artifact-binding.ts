import fs from "node:fs/promises";
import path from "node:path";
import { checksum, resolveWorkflowPath, type WorkflowLayout } from "../../artifact-store.ts";
import type { VersionedArtifactRef, WorkflowState } from "../../types.ts";
import type { PlanReviewArtifactBinding } from "./types.ts";

export type PlanReviewArtifactBindingResult =
  | { ok: true; binding: PlanReviewArtifactBinding; contents: { design: string; requirements: string; tasks: string } }
  | { ok: false; reason: string; diagnostics: string[] };

export async function bindPlanReviewArtifacts(layout: WorkflowLayout, state: WorkflowState, date = new Date()): Promise<PlanReviewArtifactBindingResult> {
  const design = state.artifacts.design;
  const requirements = state.artifacts.requirements;
  const tasks = state.artifacts.tasks;
  if (!design || !requirements || !tasks) return fail("missing-artifacts", "Plan review requires design, requirements, and tasks artifacts.");
  const approvedDesignRef = state.gates.design?.artifacts.find((artifact) => artifact.kind === "design");
  if (!approvedDesignRef) return fail("missing-design-approval", "Plan review requires an approved design gate bound to a design artifact.");
  if (!sameArtifactRef(design, approvedDesignRef)) return fail("design-approval-mismatch", "Current design artifact does not match the approved design ref.");

  try {
    const designContent = await readAndVerify(layout, design);
    const requirementsContent = await readAndVerify(layout, requirements);
    const tasksContent = await readAndVerify(layout, tasks);
    return {
      ok: true,
      binding: { design, requirements, tasks, approvedDesignRef, createdAt: date.toISOString() },
      contents: { design: designContent, requirements: requirementsContent, tasks: tasksContent },
    };
  } catch (error) {
    return fail("artifact-binding-failed", error instanceof Error ? error.message : String(error));
  }
}

export async function isPlanReviewBindingStale(layout: WorkflowLayout, binding: PlanReviewArtifactBinding, state: WorkflowState): Promise<boolean> {
  if (!state.artifacts.design || !state.artifacts.requirements || !state.artifacts.tasks) return true;
  if (!sameArtifactRef(binding.design, state.artifacts.design)) return true;
  if (!sameArtifactRef(binding.requirements, state.artifacts.requirements)) return true;
  if (!sameArtifactRef(binding.tasks, state.artifacts.tasks)) return true;
  const approvedDesignRef = state.gates.design?.artifacts.find((artifact) => artifact.kind === "design");
  if (!approvedDesignRef || !sameArtifactRef(binding.approvedDesignRef, approvedDesignRef)) return true;
  try {
    await readAndVerify(layout, binding.design);
    await readAndVerify(layout, binding.requirements);
    await readAndVerify(layout, binding.tasks);
    return false;
  } catch {
    return true;
  }
}

export function sameArtifactRef(left: VersionedArtifactRef, right: VersionedArtifactRef): boolean {
  return left.kind === right.kind && left.version === right.version && left.path === right.path && left.checksum === right.checksum;
}

async function readAndVerify(layout: WorkflowLayout, ref: VersionedArtifactRef): Promise<string> {
  if (path.isAbsolute(ref.path)) throw new Error(`${ref.kind} artifact path must be relative.`);
  const absolutePath = resolveWorkflowPath(layout, ref.path);
  const content = await fs.readFile(absolutePath, "utf8");
  const actual = checksum(content);
  if (actual !== ref.checksum) throw new Error(`Checksum mismatch for ${ref.kind} artifact ${ref.path}.`);
  return content;
}

function fail(reason: string, diagnostic: string): PlanReviewArtifactBindingResult {
  return { ok: false, reason, diagnostics: [diagnostic] };
}
