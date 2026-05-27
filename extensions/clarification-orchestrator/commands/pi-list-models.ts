import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolvePiInvocationSync } from "../runtime/agent-execution/launch-spec.ts";

export type ListedPiModel = {
  provider: string;
  model: string;
  label: string;
};

export type ListPiModelsOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  piCommand?: string;
  maxOutputBytes?: number;
  spawnProcess?: SpawnProcess;
};

type SpawnProcess = (
  command: string,
  args: string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv; shell: false; stdio: "pipe" },
) => ChildProcessWithoutNullStreams;

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

export function toAgentModelId(entry: ListedPiModel): string {
  return `${entry.provider}/${entry.model}`;
}

export function formatListedPiModelChoice(entry: ListedPiModel): string {
  return entry.label;
}

export async function listPiModels(options: ListPiModelsOptions = {}): Promise<ListedPiModel[]> {
  const env = options.env ?? process.env;
  const invocation = resolvePiInvocationSync({ explicitCommand: options.piCommand, env, cwd: options.cwd });
  const spawnProcess = options.spawnProcess ?? spawn;
  const args = [...invocation.argsPrefix, "--list-models"];
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return await new Promise<ListedPiModel[]>((resolve, reject) => {
    const child = spawnProcess(invocation.command, args, {
      cwd: options.cwd,
      env,
      shell: false,
      stdio: "pipe",
    });
    const stdout = createBoundedCapture(maxOutputBytes);
    const stderr = createBoundedCapture(maxOutputBytes);
    let settled = false;

    child.stdout.on("data", stdout.append);
    child.stderr.on("data", stderr.append);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(new Error(`Pi model discovery failed: could not run pi --list-models (${error.message}). Ensure the extension process PATH can find pi or set PI_COMMAND to the executable used where pi --list-models works.`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        const summary = stderr.text().trim();
        reject(new Error(`Pi model discovery failed: pi --list-models exited with code ${code}.${summary ? ` stderr: ${summary}` : ""}`));
        return;
      }
      resolve(parsePiListModelsOutput(stdout.text()));
    });
  });
}

export function parsePiListModelsOutput(stdout: string): ListedPiModel[] {
  const lines = stdout.split(/\r?\n/u);
  const headerIndex = lines.findIndex((line) => findHeaderColumns(line));
  if (headerIndex < 0) return [];

  const columns = findHeaderColumns(lines[headerIndex]);
  if (!columns) return [];

  const models: ListedPiModel[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.trim() || isSeparatorLine(line)) continue;

    const parts = splitTableRow(line);
    const provider = parts[columns.providerIndex]?.trim() ?? "";
    const model = parts[columns.modelIndex]?.trim() ?? "";
    if (!provider || !model) continue;
    models.push({ provider, model, label: `${provider}/${model}` });
  }

  return models;
}

type HeaderColumns = {
  providerIndex: number;
  modelIndex: number;
};

function findHeaderColumns(line: string): HeaderColumns | undefined {
  const tokens = splitTableRow(line).map((value) => value.toLowerCase());
  const providerIndex = tokens.findIndex((token) => token === "provider");
  const modelIndex = tokens.findIndex((token) => token === "model");
  if (providerIndex < 0 || modelIndex < 0) return undefined;
  return { providerIndex, modelIndex };
}

function splitTableRow(line: string): string[] {
  return line.trim().split(/\s{2,}/u).filter(Boolean);
}

function isSeparatorLine(line: string): boolean {
  return /^[\s\-─━═=|+]+$/u.test(line);
}

function createBoundedCapture(maxBytes: number): { append: (chunk: Buffer | string) => void; text: () => string } {
  let captured = "";
  let bytes = 0;

  return {
    append(chunk) {
      if (bytes >= maxBytes) return;
      const text = chunk.toString();
      const remaining = maxBytes - bytes;
      const chunkBytes = Buffer.byteLength(text);
      if (chunkBytes <= remaining) {
        captured += text;
        bytes += chunkBytes;
        return;
      }
      const buffer = Buffer.from(text);
      captured += buffer.subarray(0, remaining).toString();
      bytes = maxBytes;
    },
    text() {
      return captured;
    },
  };
}
