import fs from "node:fs";
import path from "node:path";
import type { AgentRole, ProviderQualifiedModel } from "./types.ts";
import { createAgentRunError, type AgentRunError } from "./types.ts";

export type PiInvocationSource = "explicit" | "env" | "current-cli" | "sibling-bin" | "package-bin" | "path";

export type PiInvocation = {
  command: string;
  argsPrefix: string[];
  source: PiInvocationSource;
};

export type PiInvocationResolverOptions = {
  explicitCommand?: string;
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  execPath?: string;
  cwd?: string;
  existsSync?: (filePath: string) => boolean;
};

export type AgentLaunchSpec = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  stdio: "pipe";
  shell: false;
  promptFilePath: string;
  systemPromptFilePath: string;
  outputDirectory: string;
};

export type BuildAgentLaunchSpecInput = {
  invocation: PiInvocation;
  role: AgentRole;
  model: ProviderQualifiedModel;
  promptFilePath: string;
  systemPromptFilePath: string;
  outputDirectory: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  extraArgs?: string[];
};

function cleanCommand(command: string | undefined): string | undefined {
  const trimmed = command?.trim();
  return trimmed ? trimmed : undefined;
}

function isRunnableScript(filePath: string, existsSync: (filePath: string) => boolean): boolean {
  return existsSync(filePath) && /\.(?:mjs|cjs|js)$/iu.test(filePath);
}

function isRecognizedPiCliScript(filePath: string): boolean {
  const normalized = filePath.replaceAll(path.sep, "/");
  return normalized.includes("@mariozechner/pi-coding-agent/") || normalized.includes("pi-coding-agent/");
}

export function resolvePiInvocationSync(options: PiInvocationResolverOptions = {}): PiInvocation {
  const env = options.env ?? process.env;
  const explicit = cleanCommand(options.explicitCommand);
  if (explicit) return { command: explicit, argsPrefix: [], source: "explicit" };

  const envCommand = cleanCommand(env.PI_COMMAND);
  if (envCommand) return { command: envCommand, argsPrefix: [], source: "env" };

  const existsSync = options.existsSync ?? fs.existsSync;
  const argv = options.argv ?? process.argv;
  const execPath = options.execPath ?? process.execPath;
  const argv1 = argv[1];
  if (argv1) {
    const cliPath = path.resolve(argv1);
    if (isRecognizedPiCliScript(cliPath) && isRunnableScript(cliPath, existsSync)) {
      return { command: execPath, argsPrefix: [cliPath], source: "current-cli" };
    }
  }

  const sibling = process.platform === "win32"
    ? path.join(path.dirname(execPath), "pi.cmd")
    : path.join(path.dirname(execPath), "pi");
  if (existsSync(sibling)) return { command: sibling, argsPrefix: [], source: "sibling-bin" };

  const cwd = options.cwd ?? process.cwd();
  const packageLocal = process.platform === "win32"
    ? path.join(cwd, "node_modules", ".bin", "pi.cmd")
    : path.join(cwd, "node_modules", ".bin", "pi");
  if (existsSync(packageLocal)) return { command: packageLocal, argsPrefix: [], source: "package-bin" };

  return { command: "pi", argsPrefix: [], source: "path" };
}

export function buildAgentLaunchSpec(input: BuildAgentLaunchSpecInput): AgentLaunchSpec {
  return {
    command: input.invocation.command,
    args: [
      ...input.invocation.argsPrefix,
      "--no-session",
      "--no-skills",
      "--model",
      input.model,
      "--append-system-prompt",
      input.systemPromptFilePath,
      `@${input.promptFilePath}`,
      ...(input.extraArgs ?? []),
    ],
    env: input.env,
    cwd: input.cwd,
    stdio: "pipe",
    shell: false,
    promptFilePath: input.promptFilePath,
    systemPromptFilePath: input.systemPromptFilePath,
    outputDirectory: input.outputDirectory,
  };
}

export function validateAgentLaunchSpec(spec: AgentLaunchSpec): { ok: true } | { ok: false; error: AgentRunError } {
  if (spec.shell !== false) {
    return { ok: false, error: createAgentRunError("unsafe-launch-spec", "Agent launch spec must use shell: false.") };
  }
  if (!spec.command.trim()) {
    return { ok: false, error: createAgentRunError("unsafe-launch-spec", "Agent launch spec command is empty.") };
  }
  if (!spec.args.includes("--no-session")) {
    return { ok: false, error: createAgentRunError("unsafe-launch-spec", "Agent launch spec is missing --no-session.") };
  }
  if (!spec.args.includes("--no-skills")) {
    return { ok: false, error: createAgentRunError("unsafe-launch-spec", "Agent launch spec is missing --no-skills.") };
  }
  if (!path.isAbsolute(spec.promptFilePath) || !path.isAbsolute(spec.systemPromptFilePath) || !path.isAbsolute(spec.outputDirectory)) {
    return { ok: false, error: createAgentRunError("unsafe-launch-spec", "Agent launch spec paths must be absolute.") };
  }
  return { ok: true };
}
