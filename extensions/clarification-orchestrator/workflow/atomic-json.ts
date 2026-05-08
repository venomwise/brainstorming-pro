/**
 * Derived from nicobailon/pi-subagents src/shared/atomic-json.ts.
 * Upstream notice token: pi-subagents@0.24.0.
 * Licensed under the MIT License; see vendor/pi-subagents/LICENSE and NOTICE.md.
 * Adapted for Brainstorming Pro workflow artifact/state persistence helpers.
 */

import fs from "node:fs/promises";
import path from "node:path";

export async function writeWorkflowAtomicJson(filePath: string, payload: object): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, filePath);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

export async function readWorkflowJson<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid workflow JSON at ${filePath}: ${message}`);
  }
}
