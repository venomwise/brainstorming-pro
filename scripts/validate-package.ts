import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const extensionRoot = "extensions/clarification-orchestrator";
const vendorRoot = `${extensionRoot}/vendor/pi-subagents`;
const inventoryPath = `${vendorRoot}/reuse-inventory.json`;
const required = [
  "package.json",
  "extensions/clarification-orchestrator/index.ts",
  "extensions/clarification-orchestrator/commands/brainstorm-pro.ts",
  "extensions/clarification-orchestrator/workflow/runtime.ts",
  "extensions/clarification-orchestrator/workflow/state-machine.ts",
  "extensions/clarification-orchestrator/workflow/types.ts",
  "skills/brainstorming-pro/SKILL.md",
  "skills/spec-plan-pro/SKILL.md",
  "skills/spec-exec-pro/SKILL.md",
];

const approvedDerivedDirectories = [
  `${extensionRoot}/tui/`,
  `${extensionRoot}/workflow/`,
  `${extensionRoot}/runtime/agent-execution/`,
  `${extensionRoot}/shared/`,
];
const metadataVendorFiles = new Set([
  `${vendorRoot}/LICENSE`,
  `${vendorRoot}/NOTICE.md`,
  `${vendorRoot}/README.md`,
  `${vendorRoot}/reuse-inventory.json`,
]);
const importedStatuses = new Set(["imported", "rewritten-from-reference"]);

type ReuseInventoryEntry = {
  upstreamPath: string;
  targetPath: string | null;
  classification: "direct-vendor" | "adapted-infrastructure" | "reference-only" | "not-reused";
  status: "planned" | "imported" | "rewritten-from-reference" | "reference-only" | "not-reused";
  adaptationNotes: string;
  productBoundaryNotes: string;
};

for (const file of required) {
  await fs.access(path.join(root, file));
}

const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
if (!pkg.pi?.extensions?.length) throw new Error("package.json missing pi.extensions");
if (!pkg.pi?.skills?.length) throw new Error("package.json missing pi.skills");
validateNoPiSubagentsDependency(pkg);

await validatePiSubagentsReuseMetadata();
await validateForbiddenImports();

console.log("Brainstorming Pro package validation passed.");

function validateNoPiSubagentsDependency(pkgJson: Record<string, unknown>): void {
  for (const section of ["dependencies", "devDependencies"] as const) {
    const deps = pkgJson[section] as Record<string, unknown> | undefined;
    if (deps && Object.prototype.hasOwnProperty.call(deps, "pi-subagents")) {
      throw new Error(`package.json must not declare pi-subagents in ${section}`);
    }
  }
}

async function validatePiSubagentsReuseMetadata(): Promise<void> {
  const inventoryAbsolutePath = path.join(root, inventoryPath);
  if (!(await exists(inventoryAbsolutePath))) return;

  for (const metadataFile of ["LICENSE", "NOTICE.md", "README.md"]) {
    await fs.access(path.join(root, vendorRoot, metadataFile));
  }

  const inventory = JSON.parse(await fs.readFile(inventoryAbsolutePath, "utf8")) as ReuseInventoryEntry[];
  const importedTargets = new Set<string>();
  const notice = await fs.readFile(path.join(root, vendorRoot, "NOTICE.md"), "utf8");

  for (const [index, entry] of inventory.entries()) {
    validateInventoryEntryShape(entry, index);
    if (!importedStatuses.has(entry.status)) continue;

    if (!entry.targetPath) {
      throw new Error(`Imported pi-subagents inventory entry ${entry.upstreamPath} must declare targetPath`);
    }
    const normalizedTarget = normalizeRepoPath(entry.targetPath);
    if (!normalizedTarget.startsWith(`${extensionRoot}/`)) {
      throw new Error(`Imported pi-subagents target ${entry.targetPath} must be under ${extensionRoot}/`);
    }
    if (!approvedDerivedDirectories.some((dir) => normalizedTarget.startsWith(dir))) {
      throw new Error(`Imported pi-subagents target ${entry.targetPath} is outside approved Brainstorming Pro directories`);
    }
    if (normalizedTarget.startsWith(`${vendorRoot}/`)) {
      throw new Error(`Imported pi-subagents target ${entry.targetPath} must not live under vendor metadata`);
    }

    const targetAbsolutePath = path.join(root, normalizedTarget);
    await fs.access(targetAbsolutePath);
    importedTargets.add(normalizedTarget);

    if (normalizedTarget.endsWith(".ts")) {
      await validateDerivedHeader(targetAbsolutePath, entry, notice);
    }
  }

  await validateNoUndeclaredDerivedHeaders(importedTargets);
}

function validateInventoryEntryShape(entry: ReuseInventoryEntry, index: number): void {
  for (const field of ["upstreamPath", "classification", "status", "adaptationNotes", "productBoundaryNotes"] as const) {
    if (typeof entry[field] !== "string" || entry[field].trim().length === 0) {
      throw new Error(`pi-subagents inventory entry ${index} has invalid ${field}`);
    }
  }
  if (!(typeof entry.targetPath === "string" || entry.targetPath === null)) {
    throw new Error(`pi-subagents inventory entry ${index} has invalid targetPath`);
  }
}

async function validateDerivedHeader(targetAbsolutePath: string, entry: ReuseInventoryEntry, notice: string): Promise<void> {
  const source = await fs.readFile(targetAbsolutePath, "utf8");
  const header = source.slice(0, 800);
  const noticeToken = extractNoticeToken(notice);
  const sourcePhrase = entry.status === "rewritten-from-reference"
    ? "Inspired by nicobailon/pi-subagents"
    : "Derived from nicobailon/pi-subagents";

  for (const token of [sourcePhrase, noticeToken, "MIT License", "Brainstorming Pro"]) {
    if (!header.includes(token)) {
      throw new Error(`Derived file ${entry.targetPath ?? targetAbsolutePath} missing required header token: ${token}`);
    }
  }

  if (entry.status === "rewritten-from-reference" && !notice.includes("Inspired by nicobailon/pi-subagents")) {
    throw new Error(`Rewritten-from-reference entry ${entry.targetPath ?? entry.upstreamPath} must be recorded in NOTICE.md`);
  }
}

function extractNoticeToken(notice: string): string {
  const match = notice.match(/pi-subagents@\d+\.\d+\.\d+/u);
  if (!match) throw new Error("NOTICE.md must record a pi-subagents@x.y.z commit/version token");
  return match[0];
}

async function validateNoUndeclaredDerivedHeaders(importedTargets: Set<string>): Promise<void> {
  const files = await listFiles(path.join(root, extensionRoot), ".ts");
  for (const absoluteFile of files) {
    const repoPath = normalizeRepoPath(path.relative(root, absoluteFile));
    const source = await fs.readFile(absoluteFile, "utf8");
    if (
      (source.includes("Derived from nicobailon/pi-subagents") || source.includes("Inspired by nicobailon/pi-subagents")) &&
      !importedTargets.has(repoPath)
    ) {
      throw new Error(`Derived pi-subagents file ${repoPath} is not declared as imported in reuse-inventory.json`);
    }
  }
}

async function validateForbiddenImports(): Promise<void> {
  const tsFiles = await listFiles(path.join(root, extensionRoot), ".ts");
  for (const absoluteFile of tsFiles) {
    const repoPath = normalizeRepoPath(path.relative(root, absoluteFile));
    const source = await fs.readFile(absoluteFile, "utf8");
    const imports = [...source.matchAll(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu)];

    for (const match of imports) {
      const specifier = match[1];
      if (specifier === "pi-subagents" || specifier.startsWith("pi-subagents/")) {
        throw new Error(`${repoPath} must not import external pi-subagents package ${specifier}`);
      }

      if (specifier.includes("vendor/pi-subagents")) {
        const resolved = normalizeRepoPath(path.join(path.dirname(repoPath), specifier));
        if (!metadataVendorFiles.has(resolved)) {
          throw new Error(`${repoPath} must not import executable logic from vendor/pi-subagents (${specifier})`);
        }
      }
    }
  }
}

async function listFiles(directory: string, extension: string): Promise<string[]> {
  if (!(await exists(directory))) return [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(entryPath, extension);
    if (entry.isFile() && entry.name.endsWith(extension)) return [entryPath];
    return [];
  }));
  return files.flat();
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeRepoPath(filePath: string): string {
  const normalized = path.posix.normalize(filePath.replaceAll(path.sep, "/"));
  if (normalized.startsWith("../") || normalized === ".." || path.posix.isAbsolute(normalized)) {
    throw new Error(`Path escapes repository: ${filePath}`);
  }
  return normalized;
}
