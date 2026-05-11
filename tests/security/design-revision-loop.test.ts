import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createWorkflowLayout, writeVersionedArtifact } from "../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { getDesignRevisionLedgerPaths } from "../../extensions/clarification-orchestrator/workflow/adapters/design-revision/ledger.ts";
import { rejectUnauthorizedRevisionDirectives, validateDesignRevisionOutput } from "../../extensions/clarification-orchestrator/workflow/adapters/design-revision/schemas.ts";
import { assertLatestDesignBinding } from "../../extensions/clarification-orchestrator/workflow/adapters/design-revision/source-binding.ts";

const validOutput = {
  revisedDesignMarkdown: "# Design\n\n## Summary\nUpdated\n\n## Goals\nGoal\n\n## Non-Goals\nNone\n\n## Proposed Solution\nSolution\n\n## Requirements Traceability\nTrace",
  changeSummary: ["Updated"],
  resolvedItemIds: [],
  unresolvedItemIds: [],
  assumptions: [],
  riskNotes: [],
};

test("crafted triage checksum mismatch fails closed via latest binding checksum", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-revision-security-"));
  const layout = await createWorkflowLayout(root, "demo-topic");
  const ref = await writeVersionedArtifact(layout, "design", "# Design");
  await fs.writeFile(path.join(layout.topicDir, ref.path), "tampered");
  await assert.rejects(() => assertLatestDesignBinding(layout, ref), /checksum mismatch/);
});

test("revision ledger path traversal is rejected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-revision-security-"));
  const layout = await createWorkflowLayout(root, "demo-topic");
  assert.throws(() => getDesignRevisionLedgerPaths(layout.topicDir, "../../evil"), /Unsafe design revision id/);
});

test("stale artifact reuse is rejected against latest design mirror", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-revision-security-"));
  const layout = await createWorkflowLayout(root, "demo-topic");
  const oldRef = await writeVersionedArtifact(layout, "design", "# Design v1");
  await writeVersionedArtifact(layout, "design", "# Design v2");
  await assert.rejects(() => assertLatestDesignBinding(layout, oldRef), /stale/);
});

test("unauthorized approval and planning directives are rejected", () => {
  assert.throws(() => rejectUnauthorizedRevisionDirectives({ approval: true }), /unauthorized directive/);
  assert.throws(() => rejectUnauthorizedRevisionDirectives({ nested: [{ planning: "start" }] }), /unauthorized directive/);
});

test("direct mutation attempts in reviser output are rejected", () => {
  assert.throws(() => validateDesignRevisionOutput({ ...validOutput, mutations: [{ path: "design.md" }] }), /unauthorized directive/);
  assert.throws(() => validateDesignRevisionOutput({ ...validOutput, commitArtifacts: ["design.md"] }), /unauthorized directive/);
});
