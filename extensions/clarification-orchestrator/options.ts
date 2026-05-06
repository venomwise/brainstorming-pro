import type { CleanOptions, ClarifyOptions, DiffOptions, StatusOptions } from "./types.ts";

const removedClarifyOptions = new Set(["--mode", "--threshold", "--max-rounds", "--reviewers"]);

export function parseClarifyArgs(args: string): ClarifyOptions {
  const tokens = tokenizeArgs(args);
  const requestParts: string[] = [];
  const options: ClarifyOptions = {
    request: "",
    resume: false,
    verbose: false,
    dryRun: false,
  };

  for (const token of tokens) {
    if (!token.startsWith("--")) {
      requestParts.push(token);
      continue;
    }

    const optionName = token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
    if (removedClarifyOptions.has(optionName)) {
      throw new Error(`${optionName} is no longer supported for /clarify. Use package/user/project config for review defaults; public /clarify options are --resume, --verbose, and --dry-run.`);
    }

    switch (token) {
      case "--resume":
        options.resume = true;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      default:
        throw new Error(`Unknown option '${token}'. Supported /clarify options are --resume, --verbose, and --dry-run.`);
    }
  }

  options.request = requestParts.join(" ").trim();
  if (!options.request && !options.resume) {
    throw new Error("Missing request. Usage: /clarify <request> [--verbose] [--dry-run] or /clarify --resume");
  }
  return options;
}

export function parseStatusArgs(args: string): StatusOptions {
  const topic = args.trim();
  if (!topic) throw new Error("Missing topic. Usage: /clarify-status <topic>");
  return { topic };
}

export function parseDiffArgs(args: string): DiffOptions {
  const tokens = tokenizeArgs(args);
  if (tokens.length < 1) throw new Error("Missing topic. Usage: /clarify-diff <topic> [<run1> <run2>]");
  if (tokens.length === 2) throw new Error("Provide both run IDs or neither. Usage: /clarify-diff <topic> [<run1> <run2>]");
  if (tokens.length > 3) throw new Error("Too many arguments. Usage: /clarify-diff <topic> [<run1> <run2>]");
  return { topic: tokens[0], run1: tokens[1], run2: tokens[2] };
}

export function parseCleanArgs(args: string): CleanOptions {
  const tokens = tokenizeArgs(args);
  let topic = "";
  let dryRun = false;
  let keep: number | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith("--")) {
      if (topic) throw new Error("Too many topic arguments. Usage: /clarify-clean <topic> [--dry-run] [--keep N]");
      topic = token;
      continue;
    }
    switch (token) {
      case "--dry-run":
        dryRun = true;
        break;
      case "--keep":
        keep = parsePositiveInteger(requireValue(tokens, ++i, token), token);
        break;
      default:
        throw new Error(`Unknown option '${token}'.`);
    }
  }

  if (!topic) throw new Error("Missing topic. Usage: /clarify-clean <topic> [--dry-run] [--keep N]");
  return { topic, dryRun, keep };
}

export function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (const char of input.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (quote) throw new Error("Unclosed quote in command arguments.");
  if (escaped) current += "\\";
  if (current) tokens.push(current);
  return tokens;
}

function requireValue(tokens: string[], index: number, option: string): string {
  const value = tokens[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

function parseNonNegativeInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${option} must be a non-negative integer.`);
  return parsed;
}

function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${option} must be a positive integer.`);
  return parsed;
}
