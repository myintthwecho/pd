import {
  CLAIM_REASONS,
  DECISIONS,
  type ClaimReason,
  type RefundRequest,
  type RiskDecision,
} from "./types.ts";
import { POLICY } from "./policy.ts";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

const ORDER_ID_PATTERN = /^ORD-[A-Z0-9-]{4,32}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

export function validateRefundRequest(
  input: unknown,
): ValidationResult<RefundRequest> {
  if (!isRecord(input)) {
    return { ok: false, errors: ["request must be a JSON object"] };
  }

  const errors: string[] = [];

  if (typeof input.request_id !== "string" || input.request_id.trim().length === 0) {
    errors.push("request_id must be a non-empty string");
  } else if (input.request_id.length > 64) {
    errors.push("request_id must be at most 64 characters");
  }

  if (typeof input.order_id !== "string" || !ORDER_ID_PATTERN.test(input.order_id)) {
    errors.push("order_id must match ORD-<4-32 uppercase alphanumeric/hyphen>");
  }

  if (!isFiniteNumber(input.order_value) || input.order_value <= 0 || input.order_value > 100000) {
    errors.push("order_value must be a number greater than 0 and at most 100000");
  }

  if (typeof input.currency !== "string" || !CURRENCY_PATTERN.test(input.currency)) {
    errors.push("currency must be a 3-letter uppercase ISO code");
  }

  if (input.days_since_delivery !== null) {
    const days = input.days_since_delivery;
    if (!isInteger(days)) {
      errors.push("days_since_delivery must be null or an integer between 0 and 365");
    } else if (days < 0 || days > 365) {
      errors.push("days_since_delivery must be null or an integer between 0 and 365");
    }
  }

  const priorRefunds = input.prior_refund_count_30d;
  if (!isInteger(priorRefunds)) {
    errors.push("prior_refund_count_30d must be an integer between 0 and 50");
  } else if (priorRefunds < 0 || priorRefunds > 50) {
    errors.push("prior_refund_count_30d must be an integer between 0 and 50");
  }

  if (
    typeof input.claim_reason !== "string" ||
    !CLAIM_REASONS.includes(input.claim_reason as ClaimReason)
  ) {
    errors.push(`claim_reason must be one of: ${CLAIM_REASONS.join(", ")}`);
  }

  if (typeof input.claim_text !== "string") {
    errors.push("claim_text must be a string");
  } else {
    const length = input.claim_text.trim().length;
    if (length < 10 || length > 2000) {
      errors.push("claim_text must be between 10 and 2000 characters after trimming");
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      request_id: (input.request_id as string).trim(),
      order_id: input.order_id as string,
      order_value: input.order_value as number,
      currency: input.currency as string,
      days_since_delivery: input.days_since_delivery as number | null,
      prior_refund_count_30d: input.prior_refund_count_30d as number,
      claim_reason: input.claim_reason as ClaimReason,
      claim_text: (input.claim_text as string).trim(),
    },
  };
}

export interface ValidatedJevOutput {
  modelDecision: RiskDecision;
  confidence: number;
  probabilities: Record<string, number>;
  fraudSignal: number;
}

export function validateJevResponse(
  input: unknown,
): ValidationResult<ValidatedJevOutput> {
  if (!isRecord(input)) {
    return { ok: false, errors: ["response must be a JSON object"] };
  }

  if (!isRecord(input.answers)) {
    return { ok: false, errors: ["response.answers must be an object"] };
  }

  const answers = input.answers;
  const errors: string[] = [];

  const risk = answers.refund_risk;
  if (!isRecord(risk)) {
    return { ok: false, errors: ["response.answers.refund_risk is missing"] };
  }

  const choice = risk.choice;
  if (typeof choice !== "string" || !DECISIONS.includes(choice as RiskDecision)) {
    errors.push(`refund_risk.choice must be one of: ${DECISIONS.join(", ")}`);
  }

  const probabilities: Record<string, number> = {};
  if (!isRecord(risk.probabilities)) {
    errors.push("refund_risk.probabilities must be an object");
  } else {
    for (const decision of DECISIONS) {
      const probability = risk.probabilities[decision];
      if (!isFiniteNumber(probability) || probability < 0 || probability > 1) {
        errors.push(`probability for ${decision} must be a number between 0 and 1`);
      } else {
        probabilities[decision] = probability;
      }
    }

    const sum = Object.values(probabilities).reduce((total, value) => total + value, 0);
    if (Math.abs(sum - 1) > POLICY.probabilitySumTolerance) {
      errors.push(
        `probabilities must sum to 1 within +/- ${POLICY.probabilitySumTolerance} (got ${sum.toFixed(3)})`,
      );
    }
  }

  const confidence = risk.confidence;
  if (!isFiniteNumber(confidence) || confidence < 0 || confidence > 1) {
    errors.push("refund_risk.confidence must be a number between 0 and 1");
  }

  const fraud = answers.fraud_signal;
  if (!isRecord(fraud)) {
    return { ok: false, errors: [...errors, "response.answers.fraud_signal is missing"] };
  }

  const fraudSignal = fraud.noul;
  if (!isFiniteNumber(fraudSignal) || fraudSignal < 0 || fraudSignal > 1) {
    errors.push("fraud_signal.noul must be a number between 0 and 1");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      modelDecision: choice as RiskDecision,
      confidence: confidence as number,
      probabilities,
      fraudSignal: fraudSignal as number,
    },
  };
}
