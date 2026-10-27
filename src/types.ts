export const DECISIONS = [
  "INSTANT_AUTO_APPROVE",
  "MANUAL_INSPECTION_REQUIRED",
  "FRAUD_RISK_FLAG",
] as const;

export type RiskDecision = (typeof DECISIONS)[number];

export const CLAIM_REASONS = [
  "damaged_on_arrival",
  "not_delivered",
  "not_as_described",
  "changed_mind",
  "duplicate_charge",
  "other",
] as const;

export type ClaimReason = (typeof CLAIM_REASONS)[number];

export interface RefundRequest {
  request_id: string;
  order_id: string;
  order_value: number;
  currency: string;
  days_since_delivery: number | null;
  prior_refund_count_30d: number;
  claim_reason: ClaimReason;
  claim_text: string;
}

export interface JevChoiceAnswer {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevNoulAnswer {
  noul: number;
}

export interface JevDecisionResponse {
  answers: {
    refund_risk?: JevChoiceAnswer;
    fraud_signal?: JevNoulAnswer;
  };
  model?: string;
}

export type FallbackReason =
  | "INVALID_INPUT"
  | "SERVICE_UNAVAILABLE"
  | "TIMEOUT"
  | "MALFORMED_RESPONSE"
  | "INVALID_OUTPUT"
  | "LOW_CONFIDENCE"
  | "HIGH_VALUE_OVERRIDE"
  | "FRAUD_SIGNAL_OVERRIDE";

export interface RiskResult {
  request_id: string;
  decision: RiskDecision;
  model_decision: RiskDecision | null;
  confidence: number;
  probabilities: Record<string, number>;
  fraud_signal: number | null;
  fallback_used: boolean;
  fallback_reason: FallbackReason | null;
  model: string;
}
