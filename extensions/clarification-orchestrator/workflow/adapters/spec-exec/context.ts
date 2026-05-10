import fs from "node:fs/promises";
import path from "node:path";
import { checksum, createWorkflowLayout, resolveWorkflowPath, type WorkflowLayout } from "../../artifact-store.ts";
import { validateDesignApproval, validatePlanApproval } from "../../gates.ts";
import type { ApprovalRef, VersionedArtifactRef, WorkflowState } from "../../types.ts";

export type LoadedSpecExecArtifact = {
  ref: VersionedArtifactRef;
  content: string;
  absolutePath: string;
};

export type SpecExecAdapterContext = {
  topic: string;
  runId: string;
  projectRoot: string;
  topicDir: string;
  workflowDir: string;
  layout: WorkflowLayout;
  approvedRequirements: LoadedSpecExecArtifact;
  approvedTasks: LoadedSpecExecArtifact;
  approvedDesign?: LoadedSpecExecArtifact;
  planApproval: ApprovalRef;
  state: WorkflowState;
};

export async function buildSpecExecAdapterContext(cwd: string, state: WorkflowState): Promise<SpecExecAdapterContext> {
  if (state.phase !== "executing") throw new Error("Spec-exec adapter can only run during the executing phase.");

  const layout = await createWorkflowLayout(cwd, state.topic);
  const planApproval = state.gates.plan;
  if (!planApproval) throw new Error("Spec-exec execution requires a satisfied plan approval gate.");
  await validatePlanApproval(layout, planApproval);

  const approvedRequirementsRef = findArtifact(planApproval, "requirements");
  const approvedTasksRef = findArtifact(planApproval, "tasks");
  assertSameArtifactRef(approvedRequirementsRef, state.artifacts.requirements, "requirements");
  assertSameArtifactRef(approvedTasksRef, state.artifacts.tasks, "tasks");

  const approvedRequirements = await loadApprovedArtifact(layout, approvedRequirementsRef);
  const approvedTasks = await loadApprovedArtifact(layout, approvedTasksRef);
  const approvedDesign = await loadApprovedDesignIfAvailable(layout, state);

  return {
    topic: state.topic,
    runId: state.runId,
    projectRoot: path.resolve(cwd),
    topicDir: layout.topicDir,
    workflowDir: layout.workflowDir,
    layout,
    approvedRequirements,
    approvedTasks,
    ...(approvedDesign ? { approvedDesign } : {}),
    planApproval,
    state,
  };
}

async function loadApprovedDesignIfAvailable(layout: WorkflowLayout, state: WorkflowState): Promise<LoadedSpecExecArtifact | undefined> {
  const designApproval = state.gates.design;
  const designRef = designApproval ? findArtifact(designApproval, "design") : state.artifacts.design;
  if (!designRef) return undefined;
  if (designApproval) await validateDesignApproval(layout, designApproval);
  assertSameArtifactRef(designRef, state.artifacts.design, "design");
  return loadApprovedArtifact(layout, designRef);
}

async function loadApprovedArtifact(layout: WorkflowLayout, ref: VersionedArtifactRef): Promise<LoadedSpecExecArtifact> {
  const absolutePath = resolveWorkflowPath(layout, ref.path);
  const content = await fs.readFile(absolutePath, "utf8");
  if (checksum(content) !== ref.checksum) throw new Error(`Approved ${ref.kind} artifact checksum mismatch.`);
  return { ref, content, absolutePath };
}

function findArtifact(approval: ApprovalRef, kind: VersionedArtifactRef["kind"]): VersionedArtifactRef {
  const ref = approval.artifacts.find((artifact) => artifact.kind === kind);
  if (!ref) throw new Error(`Plan approval is missing ${kind} artifact reference.`);
  return ref;
}

function assertSameArtifactRef(actual: VersionedArtifactRef, expected: VersionedArtifactRef | undefined, kind: VersionedArtifactRef["kind"]): void {
  if (!expected) throw new Error(`Workflow state is missing current ${kind} artifact reference.`);
  if (actual.kind !== expected.kind || actual.version !== expected.version || actual.path !== expected.path || actual.checksum !== expected.checksum) {
    throw new Error(`Plan approval references a stale or unexpected ${kind} artifact.`);
  }
}
