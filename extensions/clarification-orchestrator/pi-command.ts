import fs from "node:fs";
import path from "node:path";

export type PiInvocationSource = "explicit" | "env" | "current-cli" | "sibling-bin" | "package-bin" | "path";

export type PiInvocation = {
  command: string;
  argsPrefix: string[];
  displayCommand: string;
  source: PiInvocationSource;
};

export type PiInvocationResolverOptions = {
  piCommand?: string;
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  execPath?: string;
  cwd?: string;
  fileExists?: (filePath: string) => boolean;
  isExecutable?: (filePath: string) => boolean;
};

export function formatPiInvocationCommand(invocation: PiInvocation, args: string[] = []): string {
  return [invocation.command, ...invocation.argsPrefix, ...args].map(formatCommandPart).join(" ");
}

export function resolvePiInvocationSync(options: PiInvocationResolverOptions = {}): PiInvocation {
  if (options.piCommand) return createInvocation(options.piCommand, [], "explicit");

  const envPiCommand = options.env?.PI_COMMAND ?? process.env.PI_COMMAND;
  if (envPiCommand) return createInvocation(envPiCommand, [], "env");

  const argv = options.argv ?? process.argv;
  const execPath = options.execPath ?? process.execPath;
  const currentCliScript = deriveCurrentPiCliScript(argv);
  if (currentCliScript) return createInvocation(execPath, [currentCliScript], "current-cli");

  const fileExists = options.fileExists ?? defaultFileExists;
  const isExecutable = options.isExecutable ?? defaultIsExecutable;
  const siblingBin = findSiblingPiBin(execPath, fileExists, isExecutable);
  if (siblingBin) return createInvocation(siblingBin, [], "sibling-bin");

  const packageBin = findPackagePiBin(options.cwd ?? process.cwd(), fileExists, isExecutable);
  if (packageBin) return createInvocation(packageBin, [], "package-bin");

  return createInvocation("pi", [], "path");
}

export function deriveCurrentPiCliScript(argv: string[] = process.argv): string | undefined {
  const script = argv[1];
  if (!script || !path.isAbsolute(script)) return undefined;
  return isRecognizedPiCliPath(script) ? script : undefined;
}

function createInvocation(command: string, argsPrefix: string[], source: PiInvocationSource): PiInvocation {
  const invocation = { command, argsPrefix, displayCommand: "", source };
  return { ...invocation, displayCommand: formatPiInvocationCommand(invocation) };
}

function formatCommandPart(part: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(part)) return part;
  return `'${part.replaceAll("'", "'\\''")}'`;
}

function isRecognizedPiCliPath(script: string): boolean {
  const normalized = script.split(path.sep).join("/");
  return /(?:^|\/)@mariozechner\/pi-coding-agent\/dist\/cli\.js$/u.test(normalized)
    || /(?:^|\/)pi-coding-agent\/dist\/cli\.js$/u.test(normalized);
}

function findSiblingPiBin(execPath: string, fileExists: (filePath: string) => boolean, isExecutable: (filePath: string) => boolean): string | undefined {
  const binDir = path.dirname(execPath);
  const names = process.platform === "win32" ? ["pi.cmd", "pi.exe", "pi"] : ["pi"];
  return names.map((name) => path.join(binDir, name)).find((candidate) => fileExists(candidate) && isExecutable(candidate));
}

function findPackagePiBin(cwd: string, fileExists: (filePath: string) => boolean, isExecutable: (filePath: string) => boolean): string | undefined {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, "node_modules", ".bin", process.platform === "win32" ? "pi.cmd" : "pi");
    if (fileExists(candidate) && isExecutable(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function defaultFileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function defaultIsExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
