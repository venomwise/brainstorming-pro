import { randomUUID } from "node:crypto";
import { submitWorkflowDecision, type WorkflowDecisionBinding, type WorkflowDecisionResult, type WorkflowDecisionSource } from "../workflow/decision-facade.ts";
import type { RuntimeUserDecision } from "../workflow/runtime.ts";

export type DecisionSubmissionState =
  | { status: "idle"; idempotencyKey?: string; result?: undefined; error?: undefined }
  | { status: "submitting"; idempotencyKey: string; result?: undefined; error?: undefined }
  | { status: "accepted"; idempotencyKey: string; result: WorkflowDecisionResult; error?: undefined }
  | { status: "rejected"; idempotencyKey: string; result: WorkflowDecisionResult; error?: undefined }
  | { status: "transport-failed"; idempotencyKey: string; result?: undefined; error: Error };

export type DecisionSubmissionControllerOptions = {
  cwd: string;
  topic: string;
  source?: WorkflowDecisionSource;
  idempotencyKeyFactory?: () => string;
  submit?: typeof submitWorkflowDecision;
};

export type SubmitDecisionPayload = {
  decision: RuntimeUserDecision;
  binding: WorkflowDecisionBinding;
};

export class DecisionSubmissionController {
  private stateValue: DecisionSubmissionState = { status: "idle" };
  private readonly cwd: string;
  private readonly topic: string;
  private readonly source: WorkflowDecisionSource;
  private readonly idempotencyKeyFactory: () => string;
  private readonly submitDecision: typeof submitWorkflowDecision;

  constructor(options: DecisionSubmissionControllerOptions) {
    this.cwd = options.cwd;
    this.topic = options.topic;
    this.source = options.source ?? "tui";
    this.idempotencyKeyFactory = options.idempotencyKeyFactory ?? randomUUID;
    this.submitDecision = options.submit ?? submitWorkflowDecision;
  }

  get state(): DecisionSubmissionState {
    return this.stateValue;
  }

  get submitting(): boolean {
    return this.stateValue.status === "submitting";
  }

  async submit(payload: SubmitDecisionPayload): Promise<DecisionSubmissionState> {
    if (this.stateValue.status === "submitting") return this.stateValue;
    const idempotencyKey = this.stateValue.status === "transport-failed" ? this.stateValue.idempotencyKey : this.idempotencyKeyFactory();
    this.stateValue = { status: "submitting", idempotencyKey };
    try {
      const result = await this.submitDecision({ cwd: this.cwd, topic: this.topic, decision: payload.decision, binding: payload.binding, idempotency: { key: idempotencyKey }, source: this.source });
      this.stateValue = result.ok ? { status: "accepted", idempotencyKey, result } : { status: "rejected", idempotencyKey, result };
    } catch (error) {
      this.stateValue = { status: "transport-failed", idempotencyKey, error: error instanceof Error ? error : new Error(String(error)) };
    }
    return this.stateValue;
  }

  reset(): void {
    this.stateValue = { status: "idle" };
  }
}
