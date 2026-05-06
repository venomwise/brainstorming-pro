import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRun, loadState, writeVersionedDesign } from "../../extensions/clarification-orchestrator/artifact-store.ts";
import { parseClarifyArgs } from "../../extensions/clarification-orchestrator/options.ts";
import { resolveSpecPaths } from "../../extensions/clarification-orchestrator/path-guard.ts";
import { applyAutoMode, applyHybridMode, applyManualMode, parseDesignGateAction, presentDecisionGate, presentDesignReviewGate, resolveNeedsDiscussion } from "../../extensions/clarification-orchestrator/user-gate.ts";
import { runConversationalRevisionPhase } from "../../extensions/clarification-orchestrator/phases/conversational-revision.ts";
import type { DesignIssue } from "../../extensions/clarification-orchestrator/types.ts";

const baseIssue = (id: string, severity: DesignIssue["severity"] = "P1"): DesignIssue => ({
  id,
  title: `Issue ${id}`,
  description: "desc",
  category: "requirement-gap",
  severity,
  confidence: "high",
  evidence: [{ type: "design-section", section: "S", quote: "Q" }],
  riskIfIgnored: "risk",
  suggestedChange: "change",
  estimatedCost: "low",
  recommendation: severity === "P0" ? "must-fix-now" : "should-fix-now",
  tradeoffs: { pros: [], cons: [] },
});

async function setup() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-gate-"));
  const topic = resolveSpecPaths(cwd, "Gate Topic");
  return createRun(topic, parseClarifyArgs("Gate Topic"), cwd);
}

test("manual hybrid and auto modes choose expected defaults", () => {
  const low = baseIssue("low", "P3");
  const high = baseIssue("high", "P1");
  const risky = { ...baseIssue("risky", "P3"), confidence: "low" as const };
  assert.deepEqual(applyManualMode([low, high], "P1").requiresUserInput.map((i) => i.id), ["high"]);
  assert.deepEqual(applyHybridMode([low, high, risky], "P1").requiresUserInput.map((i) => i.id), ["high", "risky"]);
  const auto = applyAutoMode([low, high, risky], "P1");
  assert.deepEqual(auto.requiresUserInput.map((i) => i.id), ["risky"]);
  assert.equal(auto.decisions.find((d) => d.issueId === "high")?.decision, "accept");
});

test("presentDecisionGate persists decisions and handles needs-discussion", async () => {
  const run = await setup();
  const decisions = await presentDecisionGate({
    paths: run.paths,
    issues: [baseIssue("BP-R1-I001"), baseIssue("BP-R1-I002", "P3")],
    mode: "manual",
    threshold: "P1",
    ctx: { hasUI: true, ask: async (prompt) => prompt.includes("I001") ? "discuss" : "reject" },
  });
  assert.equal(resolveNeedsDiscussion(decisions).length, 1);
  assert.equal(decisions.length, 2);
  const state = await loadState(run.paths);
  assert.deepEqual(state.pendingDecisions, ["BP-R1-I001"]);
  assert.equal(state.rejectedIssueIds.includes("BP-R1-I002"), true);
});

test("non-interactive manual mode writes pending decisions and resume instructions", async () => {
  const run = await setup();
  await presentDecisionGate({
    paths: run.paths,
    issues: [baseIssue("BP-R1-I001")],
    mode: "manual",
    threshold: "P1",
    ctx: { hasUI: false },
  });
  const pending = await fs.readFile(path.join(run.paths.runDir, "pending-decisions.md"), "utf8");
  assert.match(pending, /Resume with/);
  const state = await loadState(run.paths);
  assert.equal(state.phase, "USER_DECISION");
});

test("parseDesignGateAction accepts only allowed gate actions", () => {
  assert.equal(parseDesignGateAction("approve"), "approve");
  assert.equal(parseDesignGateAction("review"), "review");
  assert.equal(parseDesignGateAction("revise"), "revise");
  assert.equal(parseDesignGateAction("save"), "save");
  assert.throws(() => parseDesignGateAction("continue"), /Invalid design gate action/);
});

test("design gate approval blocks pending discussed issues", async () => {
  const run = await setup();
  const state = await loadState(run.paths);
  state.pendingDecisions = ["BP-R1-I001"];
  state.metadata.pendingDecisionIds = ["BP-R1-I001"];
  await import("../../extensions/clarification-orchestrator/artifact-store.ts").then((mod) => mod.saveState(run.paths, state));
  await assert.rejects(() => presentDesignReviewGate({
    paths: run.paths,
    version: 0,
    designPath: run.paths.designPath,
    ctx: { hasUI: true, ask: async () => "approve" },
  }), /Cannot continue/);
});

test("presentDesignReviewGate persists save decision", async () => {
  const run = await setup();
  await writeVersionedDesign(run.paths, 0, "# Design");
  const decision = await presentDesignReviewGate({
    paths: run.paths,
    version: 0,
    designPath: run.paths.designPath,
    ctx: { hasUI: true, ask: async () => "save" },
  });
  assert.equal(decision.action, "save");
  const artifact = await fs.readFile(path.join(run.paths.runDir, "versions", "v0", "design-gate.json"), "utf8");
  assert.match(artifact, /save/);
});

test("conversational revision increments versions only when design changes", async () => {
  const run = await setup();
  await writeVersionedDesign(run.paths, 0, "# Design v0");
  let state = await loadState(run.paths);
  state.metadata.latestVersion = 0;
  await runConversationalRevisionPhase({ paths: run.paths, revision: { feedback: "looks ok", classification: "clarification" } });
  state = await loadState(run.paths);
  assert.equal(state.metadata.latestVersion, 0);
  state = await runConversationalRevisionPhase({ paths: run.paths, revision: { feedback: "change approach", classification: "review-worthy-major", revisedDesign: "# Design v1", reviewRecommendationReason: "major architecture change" } });
  assert.equal(state.metadata.latestVersion, 1);
  assert.match(await fs.readFile(run.paths.designPath, "utf8"), /v1/);
});
