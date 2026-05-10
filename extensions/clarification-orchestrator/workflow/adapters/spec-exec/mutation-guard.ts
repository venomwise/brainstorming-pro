import fs from "node:fs/promises";
import path from "node:path";
import { checksum } from "../../artifact-store.ts";
import type { SpecExecAdapterContext } from "./context.ts";

export type TaskMutationSnapshot = {
  tasks: { path: string; checksum: string };
  requirements: { path: string; checksum: string };
  design?: { path: string; checksum: string };
};

export async function snapshotExecutionArtifacts(context: SpecExecAdapterContext): Promise<TaskMutationSnapshot> {
  const tasksPath = path.join(context.topicDir, "tasks.md");
  return {
    tasks: { path: tasksPath, checksum: checksum(await fs.readFile(tasksPath, "utf8")) },
    requirements: { path: context.approvedRequirements.absolutePath, checksum: checksum(await fs.readFile(context.approvedRequirements.absolutePath, "utf8")) },
    ...(context.approvedDesign ? { design: { path: context.approvedDesign.absolutePath, checksum: checksum(await fs.readFile(context.approvedDesign.absolutePath, "utf8")) } } : {}),
  };
}

export async function verifyNoUnauthorizedArtifactMutation(snapshot: TaskMutationSnapshot, context: SpecExecAdapterContext): Promise<void> {
  await verifyChecksum(snapshot.tasks.path, snapshot.tasks.checksum, "tasks.md changed during child execution before code-owned checkbox writing.");
  await verifyChecksum(snapshot.requirements.path, snapshot.requirements.checksum, "Approved requirements artifact changed during child execution.");
  if (snapshot.design) await verifyChecksum(snapshot.design.path, snapshot.design.checksum, "Approved design artifact changed during child execution.");

  // Re-check the approved artifact paths from context as a defense against mismatched snapshots.
  if (snapshot.requirements.path !== context.approvedRequirements.absolutePath) throw new Error("Mutation snapshot does not match approved requirements artifact.");
  if (context.approvedDesign && snapshot.design?.path !== context.approvedDesign.absolutePath) throw new Error("Mutation snapshot does not match approved design artifact.");
}

async function verifyChecksum(filePath: string, expected: string, message: string): Promise<void> {
  const actual = checksum(await fs.readFile(filePath, "utf8"));
  if (actual !== expected) throw new Error(message);
}
