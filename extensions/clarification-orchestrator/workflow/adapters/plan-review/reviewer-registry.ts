import type { PlanReviewerRole } from "./types.ts";

const fixedPlanReviewers: readonly PlanReviewerRole[] = [
  "requirements-coverage-reviewer",
  "task-coverage-reviewer",
  "dependency-order-reviewer",
] as const;

export function getFixedPlanReviewers(_input?: unknown): PlanReviewerRole[] {
  return [...fixedPlanReviewers];
}

export function isPlanReviewerRole(value: unknown): value is PlanReviewerRole {
  return typeof value === "string" && fixedPlanReviewers.includes(value as PlanReviewerRole);
}
