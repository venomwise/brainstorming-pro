import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
    const provider = line.slice(providerStart, modelStart).trim();
    const model = line.slice(modelStart, nextColumnStart).trim();
    if (!provider || !model) continue;
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

export async function listPiModels(piCommand?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(piCommand ?? process.env.PI_COMMAND ?? "pi", ["--list-models"], { env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      reject(new Error(`pi --list-models failed to start: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else {
        const details = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
        reject(new Error(`pi --list-models failed with code ${code}${details ? `: ${details}` : "."}`));
      }
    });
  });
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
