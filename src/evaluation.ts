import { DECISIONS, type FallbackReason, type RiskDecision } from "./types.ts";

export const CASE_TYPES = ["normal", "edge", "fallback", "difficult"] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const FAULTS = [
  "invalid_input",
  "timeout",
  "service_unavailable",
  "malformed_response",
] as const;
export type Fault = (typeof FAULTS)[number];

export interface EvaluationCase {
  id: string;
  case_type: CaseType;
  input: unknown;
  expected_decision: RiskDecision;
  expected_fallback_reason: FallbackReason | null;
  check_fallback_reason: boolean;
  expected_review: boolean;
  reason: string;
  source: string;
  model_required: boolean;
  fault?: Fault;
  timeout_ms?: number;
}

export interface EvaluationDataset {
  version: number;
  created_at: string;
  preregistered: boolean;
  description: string;
  cases: EvaluationCase[];
}

export interface RecordedCase {
  source: string | null;
  captured_at: string | null;
  raw: unknown | null;
  final_decision?: RiskDecision | null;
  confidence_captured?: boolean;
  latency_ms?: number | null;
  notes?: string;
}

export interface RecordedFile {
  version: "baseline" | "grounded";
  model: string;
  captured_at: string;
  notes?: string;
  cases: Record<string, RecordedCase>;
}

export type EvaluationStatus = "pass" | "fail" | "pending";
export type EvaluatedBy =
  | "recorded_final"
  | "policy_replay"
  | "deterministic_fallback";

export interface EvaluationResult {
  id: string;
  case_type: CaseType;
  expected_decision: RiskDecision;
  actual_decision: RiskDecision | null;
  expected_fallback_reason: FallbackReason | null;
  actual_fallback_reason: FallbackReason | null;
  pass: boolean;
  fallback_check: boolean;
  status: EvaluationStatus;
  evaluated_by: EvaluatedBy | null;
  latency_ms: number | null;
  latency_source: "recorded" | "local_replay" | "not_available";
  notes: string[];
}

export interface EvaluationSummary {
  version: "baseline" | "grounded";
  generated_at: string;
  git_sha: string;
  config_sha: string;
  cases_total: number;
  cases_completed: number;
  cases_pending: number;
  correct: number;
  accuracy_completed_pct: number | null;
  accuracy_total_pct: number;
  latency: {
    samples: number;
    p50_ms: number | null;
    p95_ms: number | null;
    source: "recorded" | "not_available";
  };
  cost_per_task: string;
  cost_notes: string;
  results: EvaluationResult[];
}

export function validateDataset(
  input: unknown,
):
  | { ok: true; value: EvaluationDataset }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: ["dataset must be a JSON object"] };
  }

  if (!Array.isArray(input.cases)) {
    return { ok: false, errors: ["dataset.cases must be an array"] };
  }

  const cases = input.cases as unknown[];
  if (cases.length !== 10) {
    errors.push(`dataset must contain exactly 10 cases (got ${cases.length})`);
  }

  const ids = new Set<string>();
  const counts: Record<CaseType, number> = {
    normal: 0,
    edge: 0,
    fallback: 0,
    difficult: 0,
  };

  cases.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      errors.push(`case ${index} must be an object`);
      return;
    }

    const id = candidate.id;
    if (typeof id !== "string" || id.length === 0) {
      errors.push(`case ${index} is missing a non-empty id`);
    } else if (ids.has(id)) {
      errors.push(`case id ${id} is duplicated`);
    } else {
      ids.add(id);
    }

    const caseType = candidate.case_type;
    if (
      typeof caseType !== "string" ||
      !CASE_TYPES.includes(caseType as CaseType)
    ) {
      errors.push(`case ${String(id)} has an invalid case_type`);
    } else {
      counts[caseType as CaseType] += 1;
    }

    if (candidate.input === undefined) {
      errors.push(`case ${String(id)} is missing input`);
    }

    if (
      typeof candidate.expected_decision !== "string" ||
      !DECISIONS.includes(candidate.expected_decision as RiskDecision)
    ) {
      errors.push(`case ${String(id)} has an invalid expected_decision`);
    }

    if (
      candidate.expected_fallback_reason !== null &&
      typeof candidate.expected_fallback_reason !== "string"
    ) {
      errors.push(`case ${String(id)} has an invalid expected_fallback_reason`);
    }

    if (typeof candidate.reason !== "string" || candidate.reason.length === 0) {
      errors.push(`case ${String(id)} is missing a reason`);
    }

    if (candidate.fault !== undefined) {
      if (
        typeof candidate.fault !== "string" ||
        !FAULTS.includes(candidate.fault as Fault)
      ) {
        errors.push(`case ${String(id)} has an invalid fault`);
      }
      if (caseType !== "fallback") {
        errors.push(`case ${String(id)} uses a fault but is not a fallback case`);
      }
    }

    if (candidate.model_required === false && candidate.fault === undefined) {
      errors.push(
        `case ${String(id)} does not require a model but has no fault injection`,
      );
    }
  });

  const expectedCounts: Record<CaseType, number> = {
    normal: 3,
    edge: 3,
    fallback: 2,
    difficult: 2,
  };
  for (const caseType of CASE_TYPES) {
    if (counts[caseType] !== expectedCounts[caseType]) {
      errors.push(
        `expected ${expectedCounts[caseType]} ${caseType} cases, got ${counts[caseType]}`,
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: input as unknown as EvaluationDataset };
}

export function scoreCase(
  definition: EvaluationCase,
  actualDecision: RiskDecision | null,
  actualFallbackReason: FallbackReason | null,
  evaluatedBy: EvaluatedBy | null,
  latencyMs: number | null,
  latencySource: EvaluationResult["latency_source"],
  notes: string[] = [],
): EvaluationResult {
  if (actualDecision === null) {
    return {
      id: definition.id,
      case_type: definition.case_type,
      expected_decision: definition.expected_decision,
      actual_decision: null,
      expected_fallback_reason: definition.expected_fallback_reason,
      actual_fallback_reason: null,
      pass: false,
      fallback_check: false,
      status: "pending",
      evaluated_by: null,
      latency_ms: latencyMs,
      latency_source: latencySource,
      notes: [...notes, "No actual model output recorded yet."],
    };
  }

  const decisionMatches = actualDecision === definition.expected_decision;
  const fallbackMatches =
    !definition.check_fallback_reason ||
    actualFallbackReason === definition.expected_fallback_reason;
  const pass = decisionMatches && fallbackMatches;

  return {
    id: definition.id,
    case_type: definition.case_type,
    expected_decision: definition.expected_decision,
    actual_decision: actualDecision,
    expected_fallback_reason: definition.expected_fallback_reason,
    actual_fallback_reason: actualFallbackReason,
    pass,
    fallback_check: fallbackMatches,
    status: pass ? "pass" : "fail",
    evaluated_by: evaluatedBy,
    latency_ms: latencyMs,
    latency_source: latencySource,
    notes,
  };
}

export function summarize(args: {
  version: "baseline" | "grounded";
  results: EvaluationResult[];
  gitSha: string;
  configSha: string;
}): EvaluationSummary {
  const { results } = args;
  const completed = results.filter((result) => result.status !== "pending");
  const correct = completed.filter((result) => result.pass).length;
  const latencySamples = results
    .filter(
      (result) =>
        result.latency_source === "recorded" &&
        typeof result.latency_ms === "number",
    )
    .map((result) => result.latency_ms as number)
    .sort((left, right) => left - right);

  const p50 =
    latencySamples.length > 0 ? percentile(latencySamples, 0.5) : null;
  const p95 =
    latencySamples.length > 0 ? percentile(latencySamples, 0.95) : null;

  return {
    version: args.version,
    generated_at: new Date().toISOString(),
    git_sha: args.gitSha,
    config_sha: args.configSha,
    cases_total: results.length,
    cases_completed: completed.length,
    cases_pending: results.length - completed.length,
    correct,
    accuracy_completed_pct:
      completed.length > 0
        ? roundToTwo((correct / completed.length) * 100)
        : null,
    accuracy_total_pct: roundToTwo((correct / results.length) * 100),
    latency: {
      samples: latencySamples.length,
      p50_ms: p50,
      p95_ms: p95,
      source: latencySamples.length > 0 ? "recorded" : "not_available",
    },
    cost_per_task: "N/A",
    cost_notes:
      "The Jev Playground is free. Responses may include token usage, but the Playground does not expose per-request billing, so no cost estimate is reported.",
    results,
  };
}

function percentile(sorted: number[], fraction: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return Math.round(sorted[index] * 100) / 100;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
