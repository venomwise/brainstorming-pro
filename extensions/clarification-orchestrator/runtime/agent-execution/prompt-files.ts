import fs from "node:fs/promises";
import path from "node:path";
import { assertUnderSpecRoot } from "../../path-guard.ts";
import type { AgentRole, AgentRunPaths } from "./types.ts";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export type AgentRunDirectoryInput = {
  projectRoot: string;
  topic: string;
  workflowRunId: string;
  agentRunId: string;
};

export type WriteAgentPromptFilesInput = AgentRunDirectoryInput & {
  prompt: string;
  systemPrompt: string;
};

export function assertSafeAgentIdentifier(name: string, value: string): void {
  if (!SAFE_ID_PATTERN.test(value) || value.includes("..")) {
    throw new Error(`Unsafe ${name}: ${value}`);
  }
}

export function resolveAgentRunDirectory(input: AgentRunDirectoryInput): string {
  assertSafeAgentIdentifier("topic", input.topic);
  assertSafeAgentIdentifier("workflow run id", input.workflowRunId);
  assertSafeAgentIdentifier("agent run id", input.agentRunId);

  const specRoot = path.resolve(input.projectRoot, "specs");
  const agentRunDir = path.resolve(
    specRoot,
    input.topic,
    ".workflow",
    "runs",
    input.workflowRunId,
    "agents",
    input.agentRunId,
  );
  assertUnderSpecRoot(specRoot, agentRunDir);
  return agentRunDir;
}

export async function createAgentRunDirectory(input: AgentRunDirectoryInput): Promise<string> {
  const agentRunDir = resolveAgentRunDirectory(input);
  await fs.mkdir(agentRunDir, { recursive: true });
  return agentRunDir;
}

export async function writeAgentPromptFiles(input: WriteAgentPromptFilesInput): Promise<AgentRunPaths> {
  const agentRunDir = await createAgentRunDirectory(input);
  const promptPath = path.join(agentRunDir, "prompt.md");
  const systemPromptPath = path.join(agentRunDir, "system-prompt.md");
  await fs.writeFile(promptPath, input.prompt, "utf8");
  await fs.writeFile(systemPromptPath, input.systemPrompt, "utf8");
  return {
    agentRunDir,
    promptPath,
    systemPromptPath,
    stdoutPath: path.join(agentRunDir, "stdout.txt"),
    stderrPath: path.join(agentRunDir, "stderr.txt"),
    rawOutputPath: path.join(agentRunDir, "raw-output.txt"),
    resultPath: path.join(agentRunDir, "result.json"),
    metadataPath: path.join(agentRunDir, "metadata.json"),
  };
}
