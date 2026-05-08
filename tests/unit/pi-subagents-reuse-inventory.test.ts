import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const inventoryPath = "extensions/clarification-orchestrator/vendor/pi-subagents/reuse-inventory.json";
const validClassifications = new Set(["direct-vendor", "adapted-infrastructure", "reference-only", "not-reused"]);
const validStatuses = new Set(["planned", "imported", "rewritten-from-reference", "reference-only", "not-reused"]);

type InventoryEntry = {
  upstreamPath?: unknown;
  targetPath?: unknown;
  classification?: unknown;
  status?: unknown;
  adaptationNotes?: unknown;
  productBoundaryNotes?: unknown;
};

async function readInventory(): Promise<InventoryEntry[]> {
  return JSON.parse(await readFile(inventoryPath, "utf8")) as InventoryEntry[];
}

test("pi-subagents reuse inventory has the required shape", async () => {
  const inventory = await readInventory();

  assert.ok(Array.isArray(inventory));
  assert.ok(inventory.length >= 16, "expected all required upstream modules to be inventoried");

  for (const [index, entry] of inventory.entries()) {
    assert.equal(typeof entry.upstreamPath, "string", `entry ${index} missing upstreamPath`);
    assert.ok((entry.upstreamPath as string).length > 0, `entry ${index} has empty upstreamPath`);
    assert.ok(
      typeof entry.targetPath === "string" || entry.targetPath === null,
      `entry ${index} targetPath must be string or null`,
    );
    assert.equal(typeof entry.classification, "string", `entry ${index} missing classification`);
    assert.ok(validClassifications.has(entry.classification as string), `entry ${index} has invalid classification`);
    assert.equal(typeof entry.status, "string", `entry ${index} missing status`);
    assert.ok(validStatuses.has(entry.status as string), `entry ${index} has invalid status`);
    assert.equal(typeof entry.adaptationNotes, "string", `entry ${index} missing adaptation notes`);
    assert.ok((entry.adaptationNotes as string).trim().length > 0, `entry ${index} has empty adaptation notes`);
    assert.equal(typeof entry.productBoundaryNotes, "string", `entry ${index} missing product boundary notes`);
    assert.ok((entry.productBoundaryNotes as string).trim().length > 0, `entry ${index} has empty product boundary notes`);
  }
});

test("reference-only and not-reused entries do not require local imported targets", async () => {
  const inventory = await readInventory();

  for (const entry of inventory) {
    if (entry.classification === "reference-only" || entry.classification === "not-reused") {
      assert.equal(entry.targetPath, null, `${entry.upstreamPath as string} should not declare an imported local target`);
      assert.ok(
        entry.status === "reference-only" || entry.status === "not-reused",
        `${entry.upstreamPath as string} should use a non-imported status`,
      );
    }
  }
});

test("required upstream modules are represented in the inventory", async () => {
  const inventory = await readInventory();
  const upstreamPaths = new Set(inventory.map((entry) => entry.upstreamPath));

  for (const upstreamPath of [
    "src/tui/render-helpers.ts",
    "src/shared/formatters.ts",
    "src/shared/atomic-json.ts",
    "src/shared/jsonl-writer.ts",
    "src/shared/file-coalescer.ts",
    "src/tui/render.ts",
    "src/slash/slash-live-state.ts",
    "src/shared/status-format.ts",
    "src/runs/shared/pi-args.ts",
    "src/runs/shared/pi-spawn.ts",
    "src/runs/shared/single-output.ts",
    "src/shared/artifacts.ts",
    "src/extension/index.ts",
    "src/runs/background/*",
    "src/intercom/*",
    "src/agents/*",
  ]) {
    assert.ok(upstreamPaths.has(upstreamPath), `missing inventory entry for ${upstreamPath}`);
  }
});
