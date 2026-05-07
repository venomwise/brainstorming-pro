import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deriveCurrentPiCliScript, formatPiInvocationCommand, resolvePiInvocationSync } from "./pi-command.ts";

export type ListedPiModel = {
  provider: string;
  model: string;
  id: string;
};

export type FirstRunUi = {
  notify: (message: string, type?: "info" | "warning" | "error") => void;
  input?: (title: string, placeholder?: string) => Promise<string | undefined>;
};

export type FirstRunConfigOptions = {
  ui: FirstRunUi;
  hasUI: boolean;
  piCommand?: string;
  configPath?: string;
  listModels?: () => Promise<string>;
};

export type FirstRunConfigResult = {
  configPath: string;
  defaultModel: string;
  fallback: string[];
};

export async function ensureFirstRunConfig(options: FirstRunConfigOptions): Promise<FirstRunConfigResult> {
  if (!options.hasUI || !options.ui.input) {
    throw new Error("Brainstorming Pro first-run setup requires interactive UI. Run /clarify once interactively or create ~/.pi/agent/brainstorming-pro/config.json.");
  }

  const stdout = await (options.listModels ?? (() => listPiModels(options.piCommand)))();
  const models = parsePiListModels(stdout);
  if (models.length === 0) {
    throw new Error("Brainstorming Pro could not discover provider-qualified models from `pi --list-models`. Configure pi models first, then run /clarify again.");
  }

  const choices = renderModelChoices(models);
  options.ui.notify(["Brainstorming Pro first-run setup", "", "Choose models discovered from `pi --list-models`:", "", choices].join("\n"), "info");

  const defaultAnswer = (await options.ui.input("Choose default Brainstorming Pro model", "1"))?.trim();
  const defaultModel = selectOneModel(models, defaultAnswer || "1", "default model");

  const fallbackAnswer = (await options.ui.input("Choose fallback models (optional)", "comma-separated numbers, blank for none"))?.trim();
  const fallback = fallbackAnswer ? selectManyModels(models, fallbackAnswer, defaultModel) : [];

  const configPath = options.configPath ?? defaultUserConfigPath();
  await writeFirstRunConfig(configPath, defaultModel, fallback);
  options.ui.notify(`Brainstorming Pro config written to ${configPath}`, "info");
  return { configPath, defaultModel, fallback };
}

export function parsePiListModels(output: string): ListedPiModel[] {
  const lines = output.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  const headerIndex = lines.findIndex((line) => /\bprovider\b/u.test(line) && /\bmodel\b/u.test(line));
  if (headerIndex === -1) return [];

  const header = lines[headerIndex];
  const providerStart = header.indexOf("provider");
  const modelStart = header.indexOf("model");
  const nextColumnStart = findNextColumnStart(header, modelStart + "model".length);
  if (providerStart < 0 || modelStart < 0 || nextColumnStart <= modelStart) return [];

  const seen = new Set<string>();
  const models: ListedPiModel[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const parsed = parseModelRow(line, providerStart, modelStart, nextColumnStart);
    if (!parsed) continue;
    const { provider, model } = parsed;
    const id = `${provider}/${model}`;
    if (seen.has(id)) continue;
    seen.add(id);
    models.push({ provider, model, id });
  }
  return models;
}

export function renderModelChoices(models: ListedPiModel[]): string {
  return models.map((model, index) => `${index + 1}. ${model.id}`).join("\n");
}

export function defaultUserConfigPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "brainstorming-pro", "config.json");
}

export async function writeFirstRunConfig(configPath: string, defaultModel: string, fallback: string[]): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const config = {
    version: 1,
    models: {
      default: defaultModel,
      fallback,
    },
  };
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function resolvePiCommand(piCommand?: string): string {
  return resolvePiInvocationSync({ piCommand }).command;
}

export function deriveCurrentProcessPiCommand(argv: string[] = process.argv, execPath: string = process.execPath): string | undefined {
  if (deriveCurrentPiCliScript(argv)) return execPath;
  const candidate = argv[1];
  if (!candidate || !path.isAbsolute(candidate)) return undefined;
  const base = path.basename(candidate).toLowerCase();
  return base === "pi" || base === "pi.js" || base === "pi.cjs" || base === "pi.mjs" ? candidate : undefined;
}

export async function listPiModels(piCommand?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const invocation = resolvePiInvocationSync({ piCommand });
    const child = spawn(invocation.command, [...invocation.argsPrefix, "--list-models"], { env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        reject(new Error(formatMissingPiCommandMessage(invocation.source, formatPiInvocationCommand(invocation, ["--list-models"]))));
        return;
      }
      reject(new Error(`Brainstorming Pro could not start '${formatPiInvocationCommand(invocation, ["--list-models"])}' for pi model discovery (source: ${invocation.source}): ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) resolve(combineProcessOutput(stdout, stderr));
      else {
        const details = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
        reject(new Error(`${formatPiInvocationCommand(invocation, ["--list-models"])} failed with code ${code}${details ? `: ${details}` : "."}`));
      }
    });
  });
}

export function formatMissingPiCommandMessage(sourceOrCommand: string, displayCommand?: string): string {
  const source = displayCommand ? sourceOrCommand : "path";
  const command = displayCommand ?? `${sourceOrCommand} --list-models`;
  return [
    "Brainstorming Pro first-run setup could not find the pi executable for model discovery.",
    `The selected invocation source was '${source}' and the extension process tried to run '${command}', but the executable was not found. This can happen even when 'pi --list-models' works in your interactive shell because the extension process may inherit a different PATH.`,
    "Run /clarify-doctor for a full resolver and PATH diagnostic report.",
    "Run 'which pi' in a shell where 'pi --list-models' works, set PI_COMMAND to that absolute executable path (not a shell command with arguments), then restart pi.",
    "Alternatively, restart pi from an environment whose PATH includes the pi executable, or manually create ~/.pi/agent/brainstorming-pro/config.json with provider-qualified model IDs such as 'provider/model'.",
  ].join("\n");
}

function parseModelRow(line: string, providerStart: number, modelStart: number, nextColumnStart: number): Pick<ListedPiModel, "provider" | "model"> | undefined {
  const whitespaceParsed = parseWhitespaceSeparatedModelRow(line);
  if (whitespaceParsed) return whitespaceParsed;

  const provider = line.slice(providerStart, modelStart).trim();
  const model = line.slice(modelStart, nextColumnStart).trim();
  return provider && model ? { provider, model } : undefined;
}

function parseWhitespaceSeparatedModelRow(line: string): Pick<ListedPiModel, "provider" | "model"> | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;

  const alignedColumns = trimmed.split(/\s{2,}/u).filter(Boolean);
  if (alignedColumns.length >= 3) return { provider: alignedColumns[0], model: alignedColumns[1] };

  const plainColumns = trimmed.split(/\s+/u).filter(Boolean);
  if (plainColumns.length >= 3) return { provider: plainColumns[0], model: plainColumns[1] };

  return undefined;
}

function combineProcessOutput(stdout: string, stderr: string): string {
  return [stdout, stderr].filter(Boolean).join("\n");
}

function findNextColumnStart(header: string, after: number): number {
  const match = header.slice(after).match(/\S/u);
  return match?.index === undefined ? header.length : after + match.index;
}

function selectOneModel(models: ListedPiModel[], answer: string, label: string): string {
  if (!/^\d+$/u.test(answer)) throw new Error(`Invalid ${label} choice '${answer}'. Enter a model number.`);
  const model = models[Number(answer) - 1];
  if (!model) throw new Error(`Invalid ${label} choice '${answer}'.`);
  return model.id;
}

function selectManyModels(models: ListedPiModel[], answer: string, exclude?: string): string[] {
  const selected: string[] = [];
  for (const part of answer.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const id = selectOneModel(models, trimmed, "fallback model");
    if (id !== exclude && !selected.includes(id)) selected.push(id);
  }
  return selected;
}
