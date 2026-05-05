import type { AutomationMode, CleanOptions, ClarifyOptions, DiffOptions, IssueSeverity, StatusOptions } from "./types.ts";

const modes = new Set<AutomationMode>(["manual", "hybrid", "auto"]);
const severities = new Set<IssueSeverity>(["P0", "P1", "P2", "P3"]);

export function parseClarifyArgs(args: string): ClarifyOptions {
  const tokens = tokenizeArgs(args);
  const topicParts: string[] = [];
  const options: ClarifyOptions = {
    topic: "",
    mode: "hybrid",
    maxRounds: 2,
    threshold: "P1",
    reviewers: ["product", "architecture", "risk", "testing"],
    resume: false,
    verbose: false,
    dryRun: false,
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith("--")) {
      topicParts.push(token);
      continue;
    }

    switch (token) {
      case "--mode": {
        const value = requireValue(tokens, ++i, token);
        if (!modes.has(value as AutomationMode)) throw new Error(`Invalid --mode '${value}'. Expected manual, hybrid, or auto.`);
        options.mode = value as AutomationMode;
        break;
      }
      case "--max-rounds": {
        const value = parseNonNegativeInteger(requireValue(tokens, ++i, token), token);
        options.maxRounds = value;
        break;
      }
      case "--threshold": {
        const value = requireValue(tokens, ++i, token);
        if (!severities.has(value as IssueSeverity)) throw new Error(`Invalid --threshold '${value}'. Expected P0, P1, P2, or P3.`);
        options.threshold = value as IssueSeverity;
        break;
      }
      case "--reviewers": {
        const value = requireValue(tokens, ++i, token);
        options.reviewers = value.split(",").map((item) => item.trim()).filter(Boolean);
        if (options.reviewers.length === 0) throw new Error("--reviewers must contain at least one reviewer name.");
        break;
      }
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
        throw new Error(`Unknown option '${token}'.`);
    }
  }

  options.topic = topicParts.join(" ").trim();
  if (!options.topic) throw new Error("Missing topic. Usage: /clarify <topic> [options]");
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
