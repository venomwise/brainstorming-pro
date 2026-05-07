import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseClarifyArgs } from "../../extensions/clarification-orchestrator/options.ts";
import { resolveSpecPaths } from "../../extensions/clarification-orchestrator/path-guard.ts";
import { createRun, saveState } from "../../extensions/clarification-orchestrator/artifact-store.ts";
import { bundledDefaults } from "../../extensions/clarification-orchestrator/config.ts";
import { runDiscoveryPhase } from "../../extensions/clarification-orchestrator/phases/discovery.ts";
import { runReviewPhase } from "../../extensions/clarification-orchestrator/phases/review.ts";
import { runTriagePhase } from "../../extensions/clarification-orchestrator/phases/triage.ts";
import { runRefinePhase } from "../../extensions/clarification-orchestrator/phases/refine.ts";
import { runVerifyPhase } from "../../extensions/clarification-orchestrator/phases/verify.ts";
import { runFinalApprovalPhase } from "../../extensions/clarification-orchestrator/phases/final-approval.ts";
import { evaluateVerificationLoop, runWorkflow } from "../../extensions/clarification-orchestrator/workflow.ts";
import type { AgentDefinition, DesignIssue, UserDecision } from "../../extensions/clarification-orchestrator/types.ts";

const agent = (name: string, role: AgentDefinition["role"]): AgentDefinition => ({
  name,
  role,
  description: "",
  path: "",
  source: "bundled",
  tools: [],
  prompt: "",
});

const issue: DesignIssue = {
  id: "REV-1",
  title: "Clarify persistence",
  description: "The design needs durable state.",
  category: "requirement-gap",
  severity: "P1",
  confidence: "high",
  evidence: [{ type: "design-section", section: "State", quote: "state" }],
  riskIfIgnored: "resume may fail",
  suggestedChange: "Add durable state requirements",
  estimatedCost: "medium",
  recommendation: "should-fix-now",
  tradeoffs: { pros: ["safer"], cons: ["more work"] },
};

async function setup() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-workflow-"));
  const topic = resolveSpecPaths(cwd, "Workflow Topic");
  const options = parseClarifyArgs("Workflow Topic");
  const run = await createRun(topic, options, cwd);
  return { cwd, topic, options, ...run };
}

test("mocked workflow phases produce canonical artifacts and final handoff", async () => {
  const env = await setup();
  let state = env.state;
  state = await runDiscoveryPhase({
    paths: env.paths,
    state,
    config: bundledDefaults,
    designer: agent("designer", "designer"),
    cwd: env.cwd,
    runDesigner: async () => ({
      agentName: "designer",
      role: "designer",
      status: "success",
      attempt: 1,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 1,
      parsedOutput: { discoveryMarkdown: "# Discovery", designMarkdown: "# Design\n\nState" },
    }),
  });
  assert.match(await fs.readFile(env.paths.designPath, "utf8"), /# Design/);

  const reviewState = await runReviewPhase({
    paths: env.paths,
    state,
    config: { ...bundledDefaults, reviewers: { ...bundledDefaults.reviewers, concurrency: 1 } },
    reviewers: [agent("reviewer-product", "reviewer")],
    cwd: env.cwd,
    currentDesign: "# Design",
    runReviewer: async () => ({
      agentName: "reviewer-product",
      role: "reviewer",
      status: "success",
      attempt: 1,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 1,
      parsedOutput: { reviewer: "reviewer-product", issues: [issue], summary: "one issue" },
    }),
  });
  assert.equal(reviewState.reviewers[0]?.status, "complete");

  const reviewArtifacts = [{ reviewer: "reviewer-product", status: "success" as const, issues: [issue], summary: "one issue" }];
  const triageState = await runTriagePhase({
    paths: env.paths,
    state: reviewState,
    config: bundledDefaults,
    triager: agent("triager", "triager"),
    cwd: env.cwd,
    reviewArtifacts,
    runTriager: async () => ({
      agentName: "triager",
      role: "triager",
      status: "success",
      attempt: 1,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 1,
      parsedOutput: { issues: [issue], summary: "canonical" },
    }),
  });
  assert.deepEqual(triageState.pendingDecisions, ["BP-R1-I001"]);

  const decisions: UserDecision[] = [{ issueId: "BP-R1-I001", decision: "accept", reason: "needed" }];
  const refineState = await runRefinePhase({
    paths: env.paths,
    state: triageState,
    config: bundledDefaults,
    refiner: agent("refiner", "refiner"),
    cwd: env.cwd,
    currentDesign: "# Design",
    decisions,
    runRefiner: async () => ({
      agentName: "refiner",
      role: "refiner",
      status: "success",
      attempt: 1,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 1,
      parsedOutput: { revisedDesign: "# Design\n\nDurable state added", changeLog: [{ issueId: "BP-R1-I001", summary: "Added state" }] },
    }),
  });
  assert.equal(refineState.refinementAttempts, 1);

  const verifyState = await runVerifyPhase({
    paths: env.paths,
    state: refineState,
    config: bundledDefaults,
    verifier: agent("verifier", "verifier"),
    cwd: env.cwd,
    refinedDesign: "# Design\n\nDurable state added",
    decisions,
    runVerifier: async () => ({
      agentName: "verifier",
      role: "verifier",
      status: "success",
      attempt: 1,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 1,
      parsedOutput: { results: [{ issueId: "BP-R1-I001", status: "completed", evidence: "Durable state added" }], summary: "verified" },
    }),
  });
  assert.equal(evaluateVerificationLoop(verifyState).action, "complete");

  const finalState = await runFinalApprovalPhase({ paths: env.paths, approved: true });
  assert.equal(finalState.phase, "COMPLETE");
  const final = await fs.readFile(path.join(env.paths.runDir, "final-approval.md"), "utf8");
  assert.match(final, /spec-plan/);
  assert.match(final, /does not auto-invoke/);
});

test("workflow orchestration runs mocked designer before design gate", async () => {
  const env = await setup();
  const state = await runWorkflow({
    paths: env.paths,
    options: env.options,
    config: bundledDefaults,
    ctx: { hasUI: true, cwd: env.cwd, ask: async () => "save" },
    runDiscovery: async (params) => runDiscoveryPhase({
      ...params,
      runDesigner: async () => ({
        agentName: "designer",
        role: "designer",
        status: "success",
        attempt: 1,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 1,
        parsedOutput: { discoveryMarkdown: "# Discovery", designMarkdown: "# Design\n\nReady" },
      }),
    }),
  });
  assert.equal(state.phase, "DESIGN_REVIEW_GATE");
  assert.equal(state.completedArtifacts.includes(env.paths.designPath), true);
  await fs.access(env.paths.designPath);
  await fs.access(path.join(env.paths.runDir, "versions", "v0", "design.md"));
});

test("workflow orchestration aborts when design gate artifact is missing", async () => {
  const env = await setup();
  const state = await runDiscoveryPhase({
    paths: env.paths,
    state: env.state,
    config: bundledDefaults,
    designer: agent("designer", "designer"),
    cwd: env.cwd,
    runDesigner: async () => ({
      agentName: "designer",
      role: "designer",
      status: "success",
      attempt: 1,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 1,
      parsedOutput: { discoveryMarkdown: "# Discovery", designMarkdown: "# Design" },
    }),
  });
  await fs.rm(env.paths.designPath);
  await saveState(env.paths, { ...state, phase: "V0_BRAINSTORMING" });
  const aborted = await runWorkflow({
    paths: env.paths,
    options: env.options,
    config: bundledDefaults,
    ctx: { hasUI: true, cwd: env.cwd },
    runDiscovery: async () => state,
  });
  assert.equal(aborted.phase, "ABORTED");
  assert.match(aborted.errors.at(-1)?.message ?? "", /missing/);
});

test("verification loop requests targeted refinement until maxRounds", async () => {
  const env = await setup();
  env.state.verification.unresolvedP0P1 = ["BP-R1-I001"];
  env.state.refinementAttempts = 0;
  assert.deepEqual(evaluateVerificationLoop(env.state), { action: "refine", issueIds: ["BP-R1-I001"] });
  env.state.refinementAttempts = 2;
  assert.equal(evaluateVerificationLoop(env.state).action, "max-rounds-reached");
});
