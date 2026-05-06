import { Type } from "typebox";

const AutomationMode = Type.Union([Type.Literal("manual"), Type.Literal("hybrid"), Type.Literal("auto")]);
const IssueSeverity = Type.Union([Type.Literal("P0"), Type.Literal("P1"), Type.Literal("P2"), Type.Literal("P3")]);
const IssueConfidence = Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]);
const EstimatedCost = Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]);
const WorkflowPhase = Type.Union([
  Type.Literal("INIT"),
  Type.Literal("REQUEST_CAPTURE"),
  Type.Literal("TOPIC_PROPOSAL"),
  Type.Literal("TOPIC_CONFIRMATION"),
  Type.Literal("V0_BRAINSTORMING"),
  Type.Literal("DESIGN_REVIEW_GATE"),
  Type.Literal("ISSUE_DECISION_GATE"),
  Type.Literal("CONVERSATIONAL_REVISION"),
  Type.Literal("DISCOVERY"),
  Type.Literal("INITIAL_DESIGN"),
  Type.Literal("REVIEW"),
  Type.Literal("TRIAGE"),
  Type.Literal("USER_DECISION"),
  Type.Literal("REFINE"),
  Type.Literal("VERIFY"),
  Type.Literal("FINAL_APPROVAL"),
  Type.Literal("COMPLETE"),
  Type.Literal("ABORTED"),
  Type.Literal("INTERRUPTED"),
]);

export const EvidenceSchema = Type.Union([
  Type.Object({
    type: Type.Literal("design-section"),
    section: Type.String({ minLength: 1 }),
    quote: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    type: Type.Literal("artifact"),
    path: Type.String({ minLength: 1 }),
    quote: Type.Optional(Type.String()),
  }),
  Type.Object({
    type: Type.Literal("repo-file"),
    path: Type.String({ minLength: 1 }),
    lineStart: Type.Optional(Type.Number({ minimum: 1 })),
    lineEnd: Type.Optional(Type.Number({ minimum: 1 })),
    quote: Type.Optional(Type.String()),
  }),
]);

export const DesignIssueSchema = Type.Object({
  id: Type.String(),
  sourceReviewer: Type.Optional(Type.String()),
  sourceIssueIds: Type.Optional(Type.Array(Type.String())),
  title: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  category: Type.Union([
    Type.Literal("requirement-gap"),
    Type.Literal("architecture"),
    Type.Literal("data-flow"),
    Type.Literal("error-handling"),
    Type.Literal("security"),
    Type.Literal("ux"),
    Type.Literal("testing"),
    Type.Literal("maintainability"),
    Type.Literal("scope-risk"),
    Type.Literal("future-extension"),
  ]),
  severity: IssueSeverity,
  confidence: IssueConfidence,
  evidence: Type.Array(EvidenceSchema, { minItems: 1 }),
  riskIfIgnored: Type.String({ minLength: 1 }),
  suggestedChange: Type.String({ minLength: 1 }),
  estimatedCost: EstimatedCost,
  recommendation: Type.Union([
    Type.Literal("must-fix-now"),
    Type.Literal("should-fix-now"),
    Type.Literal("defer"),
    Type.Literal("optional"),
    Type.Literal("reject"),
  ]),
  tradeoffs: Type.Object({
    pros: Type.Array(Type.String()),
    cons: Type.Array(Type.String()),
  }),
  dependsOn: Type.Optional(Type.Array(Type.String())),
  conflictsWith: Type.Optional(Type.Array(Type.String())),
  supersedes: Type.Optional(Type.Array(Type.String())),
  duplicateOf: Type.Optional(Type.String()),
});

export const UserDecisionSchema = Type.Object({
  issueId: Type.String({ minLength: 1 }),
  decision: Type.Union([
    Type.Literal("accept"),
    Type.Literal("reject"),
    Type.Literal("defer"),
    Type.Literal("discuss"),
    Type.Literal("needs-discussion"),
  ]),
  reason: Type.Optional(Type.String()),
});

export const VerificationResultSchema = Type.Object({
  issueId: Type.String({ minLength: 1 }),
  status: Type.Union([
    Type.Literal("completed"),
    Type.Literal("partially-completed"),
    Type.Literal("missing"),
    Type.Literal("over-implemented"),
  ]),
  evidence: Type.String({ minLength: 1 }),
  requiredFollowup: Type.Optional(Type.String()),
});

export const DesignerOutputSchema = Type.Object({
  discoveryMarkdown: Type.String({ minLength: 1 }),
  designMarkdown: Type.String({ minLength: 1 }),
});

export const ReviewerOutputSchema = Type.Object({
  reviewer: Type.String({ minLength: 1 }),
  issues: Type.Array(DesignIssueSchema),
  summary: Type.Optional(Type.String()),
});

export const TriageOutputSchema = Type.Object({
  issues: Type.Array(DesignIssueSchema),
  summary: Type.Optional(Type.String()),
});

export const RefinerOutputSchema = Type.Object({
  revisedDesign: Type.String({ minLength: 1 }),
  changeLog: Type.Array(
    Type.Object({
      issueId: Type.String({ minLength: 1 }),
      summary: Type.String({ minLength: 1 }),
      designSections: Type.Optional(Type.Array(Type.String())),
    }),
  ),
  noOpJustifications: Type.Optional(
    Type.Array(
      Type.Object({
        issueId: Type.String({ minLength: 1 }),
        reason: Type.String({ minLength: 1 }),
      }),
    ),
  ),
});

export const ClarifyOptionsSchema = Type.Object({
  request: Type.String(),
  proposedTopic: Type.Optional(Type.String()),
  confirmedTopic: Type.Optional(Type.String()),
  resume: Type.Boolean(),
  verbose: Type.Boolean(),
  dryRun: Type.Boolean(),
});

const WorkflowErrorSchema = Type.Object({
  type: Type.Union([
    Type.Literal("validation"),
    Type.Literal("config"),
    Type.Literal("path-safety"),
    Type.Literal("subagent"),
    Type.Literal("model-unavailable"),
    Type.Literal("timeout"),
    Type.Literal("cancelled"),
    Type.Literal("artifact-write"),
    Type.Literal("rate-limit"),
    Type.Literal("unknown"),
  ]),
  message: Type.String(),
  phase: Type.Optional(WorkflowPhase),
  recoverable: Type.Boolean(),
  path: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
  occurredAt: Type.String(),
});

export const WorkflowStateSchema = Type.Object({
  version: Type.Literal(1),
  metadata: Type.Object({
    runId: Type.String(),
    topic: Type.Object({
      displayName: Type.String(),
      slug: Type.String(),
      specDir: Type.String(),
      designPath: Type.String(),
      clarificationDir: Type.String(),
    }),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    cwd: Type.String(),
  }),
  phase: WorkflowPhase,
  options: ClarifyOptionsSchema,
  round: Type.Number({ minimum: 0 }),
  refinementAttempts: Type.Number({ minimum: 0 }),
  completedArtifacts: Type.Array(Type.String()),
  pendingDecisions: Type.Array(Type.String()),
  acceptedIssueIds: Type.Array(Type.String()),
  rejectedIssueIds: Type.Array(Type.String()),
  deferredIssueIds: Type.Array(Type.String()),
  verification: Type.Object({
    verified: Type.Boolean(),
    results: Type.Array(VerificationResultSchema),
    unresolvedP0P1: Type.Array(Type.String()),
    unreviewed: Type.Optional(Type.Boolean()),
    unverifiedReason: Type.Optional(Type.String()),
  }),
  reviewers: Type.Array(
    Type.Object({
      name: Type.String(),
      status: Type.Union([Type.Literal("pending"), Type.Literal("running"), Type.Literal("complete"), Type.Literal("failed")]),
      issueCount: Type.Optional(Type.Number({ minimum: 0 })),
      error: Type.Optional(WorkflowErrorSchema),
    }),
  ),
  errors: Type.Array(WorkflowErrorSchema),
  execution: Type.Object({
    status: Type.Union([Type.Literal("running"), Type.Literal("complete"), Type.Literal("failed"), Type.Literal("interrupted")]),
    startedAt: Type.String(),
    endedAt: Type.Optional(Type.String()),
    durationMs: Type.Optional(Type.Number({ minimum: 0 })),
    totalInputTokens: Type.Optional(Type.Number({ minimum: 0 })),
    totalOutputTokens: Type.Optional(Type.Number({ minimum: 0 })),
    totalCostUsd: Type.Optional(Type.Number({ minimum: 0 })),
    agentRuns: Type.Number({ minimum: 0 }),
    failedAgentRuns: Type.Number({ minimum: 0 }),
  }),
});

export const BrainstormingProConfigSchema = Type.Object({
  version: Type.Literal(1),
  defaults: Type.Object({
    mode: AutomationMode,
    maxRounds: Type.Number({ minimum: 0 }),
    threshold: IssueSeverity,
  }),
  reviewers: Type.Object({
    enabled: Type.Array(Type.String()),
    disabled: Type.Array(Type.String()),
    custom: Type.Array(
      Type.Object({
        name: Type.String(),
        description: Type.String(),
        agentPath: Type.String(),
        model: Type.Optional(Type.String()),
        tools: Type.Optional(Type.Array(Type.String())),
        priority: Type.Optional(Type.Number()),
      }),
    ),
    concurrency: Type.Number({ minimum: 1 }),
  }),
  agents: Type.Record(
    Type.String(),
    Type.Object({
      model: Type.Optional(Type.String()),
      tools: Type.Optional(Type.Array(Type.String())),
      timeoutMs: Type.Optional(Type.Number({ minimum: 1 })),
      maxOutputBytes: Type.Optional(Type.Number({ minimum: 1 })),
    }),
  ),
  models: Type.Object({
    default: Type.Optional(Type.String()),
    fallback: Type.Array(Type.String()),
  }),
  retry: Type.Object({
    maxAttempts: Type.Number({ minimum: 1 }),
    initialDelayMs: Type.Number({ minimum: 0 }),
    maxDelayMs: Type.Number({ minimum: 0 }),
    retryableErrors: Type.Array(Type.String()),
  }),
  security: Type.Object({
    allowProjectAgents: Type.Boolean(),
    allowProjectToolExpansion: Type.Boolean(),
    debugArtifacts: Type.Union([Type.Literal("enabled"), Type.Literal("redacted"), Type.Literal("disabled")]),
  }),
  artifacts: Type.Object({
    retention: Type.Object({
      maxRuns: Type.Number({ minimum: 1 }),
      maxAgeDays: Type.Number({ minimum: 1 }),
    }),
  }),
  ui: Type.Object({
    verbose: Type.Boolean(),
    progress: Type.Boolean(),
  }),
});

export const ExecutionLogSchema = Type.Object({
  version: Type.Literal(1),
  runId: Type.String(),
  events: Type.Array(
    Type.Object({
      timestamp: Type.String(),
      type: Type.String(),
      phase: Type.Optional(WorkflowPhase),
      message: Type.String(),
      details: Type.Optional(Type.Unknown()),
    }),
  ),
});
