import fs from "node:fs/promises";
import path from "node:path";

import { assertWorkflowPath, type WorkflowLayout } from "../../artifact-store.ts";
import { writeWorkflowAtomicJson } from "../../atomic-json.ts";
import {
  validateDesignRevisionAuthorization,
  validateDesignRevisionOutput,
  validateDesignRevisionRecord,
  validateDesignRevisionRequest,
} from "./schemas.ts";
import type {
  DesignRevisionAuthorization,
  DesignRevisionOutput,
  DesignRevisionRecord,
  DesignRevisionRequest,
  DesignRevisionValidationResult,
} from "./types.ts";

export type DesignRevisionLedgerPaths = {
  revisionDir: string;
  authorization: string;
  request: string;
  prompt: string;
  systemPrompt: string;
  childResult: string;
  output: string;
  validation: string;
  record: string;
};

const safeRevisionId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export function getDesignRevisionLedgerPaths(topicDir: string, revisionId: string): DesignRevisionLedgerPaths {
  if (!safeRevisionId.test(revisionId) || revisionId.includes("..")) throw new Error(`Unsafe design revision id: ${revisionId}`);
  const root = path.resolve(topicDir);
  const revisionDir = path.resolve(root, ".workflow", "revisions", "design", revisionId);
  assertContained(root, revisionDir);
  const file = (name: string): string => {
    const target = path.join(revisionDir, name);
    assertContained(root, target);
    return target;
  };
  return {
    revisionDir,
    authorization: file("authorization.json"),
    request: file("request.json"),
    prompt: file("prompt.md"),
    systemPrompt: file("system-prompt.md"),
    childResult: file("child-result.json"),
    output: file("output.json"),
    validation: file("validation.json"),
    record: file("record.json"),
  };
}

export async function writeDesignRevisionAuthorization(layout: WorkflowLayout, authorization: DesignRevisionAuthorization): Promise<void> {
  const paths = await ensureLedger(layout, authorization.revisionId);
  await writeWorkflowAtomicJson(paths.authorization, authorization);
}

export async function readDesignRevisionAuthorization(layout: WorkflowLayout, revisionId: string): Promise<DesignRevisionAuthorization> {
  return validateDesignRevisionAuthorization(await readJson(ledgerPaths(layout, revisionId).authorization, "authorization.json"));
}

export async function writeDesignRevisionRequest(layout: WorkflowLayout, request: DesignRevisionRequest): Promise<void> {
  const paths = await ensureLedger(layout, request.revisionId);
  await writeWorkflowAtomicJson(paths.request, request);
}

export async function readDesignRevisionRequest(layout: WorkflowLayout, revisionId: string): Promise<DesignRevisionRequest> {
  return validateDesignRevisionRequest(await readJson(ledgerPaths(layout, revisionId).request, "request.json"));
}

export async function writeDesignRevisionPrompts(layout: WorkflowLayout, revisionId: string, prompts: { prompt: string; systemPrompt: string }): Promise<void> {
  const paths = await ensureLedger(layout, revisionId);
  await fs.writeFile(paths.prompt, prompts.prompt);
  await fs.writeFile(paths.systemPrompt, prompts.systemPrompt);
}

export async function readDesignRevisionPrompts(layout: WorkflowLayout, revisionId: string): Promise<{ prompt: string; systemPrompt: string }> {
  const paths = ledgerPaths(layout, revisionId);
  return { prompt: await readText(paths.prompt, "prompt.md"), systemPrompt: await readText(paths.systemPrompt, "system-prompt.md") };
}

export async function writeDesignRevisionChildResult(layout: WorkflowLayout, revisionId: string, childResult: object): Promise<void> {
  const paths = await ensureLedger(layout, revisionId);
  await writeWorkflowAtomicJson(paths.childResult, childResult);
}

export async function readDesignRevisionChildResult(layout: WorkflowLayout, revisionId: string): Promise<unknown> {
  return await readJson(ledgerPaths(layout, revisionId).childResult, "child-result.json");
}

export async function writeDesignRevisionOutput(layout: WorkflowLayout, revisionId: string, output: DesignRevisionOutput): Promise<void> {
  const paths = await ensureLedger(layout, revisionId);
  await writeWorkflowAtomicJson(paths.output, output);
}

export async function readDesignRevisionOutput(layout: WorkflowLayout, revisionId: string, knownItemIds?: ReadonlySet<string>): Promise<DesignRevisionOutput> {
  return validateDesignRevisionOutput(await readJson(ledgerPaths(layout, revisionId).output, "output.json"), knownItemIds);
}

export async function writeDesignRevisionValidation(layout: WorkflowLayout, revisionId: string, validation: DesignRevisionValidationResult): Promise<void> {
  const paths = await ensureLedger(layout, revisionId);
  await writeWorkflowAtomicJson(paths.validation, validation);
}

export async function readDesignRevisionValidation(layout: WorkflowLayout, revisionId: string): Promise<DesignRevisionValidationResult> {
  const record = await readJson(ledgerPaths(layout, revisionId).validation, "validation.json");
  if (!record || typeof record !== "object") throw new Error("Revision ledger is missing, corrupted, or inconsistent: validation.json");
  return record as DesignRevisionValidationResult;
}

export async function writeDesignRevisionRecord(layout: WorkflowLayout, record: DesignRevisionRecord): Promise<void> {
  const paths = await ensureLedger(layout, record.revisionId);
  await writeWorkflowAtomicJson(paths.record, record);
}

export async function readDesignRevisionRecord(layout: WorkflowLayout, revisionId: string): Promise<DesignRevisionRecord> {
  return validateDesignRevisionRecord(await readJson(ledgerPaths(layout, revisionId).record, "record.json"));
}

function ledgerPaths(layout: WorkflowLayout, revisionId: string): DesignRevisionLedgerPaths {
  const paths = getDesignRevisionLedgerPaths(layout.topicDir, revisionId);
  for (const target of Object.values(paths)) assertWorkflowPath(layout, target);
  return paths;
}

async function ensureLedger(layout: WorkflowLayout, revisionId: string): Promise<DesignRevisionLedgerPaths> {
  const paths = ledgerPaths(layout, revisionId);
  await fs.mkdir(paths.revisionDir, { recursive: true });
  return paths;
}

async function readJson(filePath: string, name: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Revision ledger is missing, corrupted, or inconsistent: ${name}`, { cause: error });
  }
}

async function readText(filePath: string, name: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Revision ledger is missing, corrupted, or inconsistent: ${name}`, { cause: error });
  }
}

function assertContained(root: string, targetPath: string): void {
  const relative = path.relative(root, path.resolve(targetPath));
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new Error(`Unsafe design revision ledger path outside topic directory: ${targetPath}`);
}
