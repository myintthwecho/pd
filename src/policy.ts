import type { FallbackReason, RefundRequest, RiskDecision } from "./types.ts";

export const POLICY = {
  confidenceMin: 0.55,
  highValueThreshold: 500,
  fraudSignalMin: 0.8,
  timeoutMs: 4000,
  probabilitySumTolerance: 0.05,
} as const;

export interface PolicyOutcome {
  decision: RiskDecision;
  fallback_used: boolean;
  fallback_reason: FallbackReason | null;
}

export function applyPolicy(
  request: RefundRequest,
  modelDecision: RiskDecision,
  confidence: number,
  fraudSignal: number,
): PolicyOutcome {
  if (modelDecision === "FRAUD_RISK_FLAG") {
    return {
      decision: "FRAUD_RISK_FLAG",
      fallback_used: false,
      fallback_reason: null,
    };
  }

  if (modelDecision === "MANUAL_INSPECTION_REQUIRED") {
    return {
      decision: "MANUAL_INSPECTION_REQUIRED",
      fallback_used: false,
      fallback_reason: null,
    };
  }

  if (request.order_value > POLICY.highValueThreshold) {
    return {
      decision: "MANUAL_INSPECTION_REQUIRED",
      fallback_used: true,
      fallback_reason: "HIGH_VALUE_OVERRIDE",
    };
  }

  if (fraudSignal >= POLICY.fraudSignalMin) {
    return {
      decision: "MANUAL_INSPECTION_REQUIRED",
      fallback_used: true,
      fallback_reason: "FRAUD_SIGNAL_OVERRIDE",
    };
  }

  if (confidence < POLICY.confidenceMin) {
    return {
      decision: "MANUAL_INSPECTION_REQUIRED",
      fallback_used: true,
      fallback_reason: "LOW_CONFIDENCE",
    };
  }

  return {
    decision: "INSTANT_AUTO_APPROVE",
    fallback_used: false,
    fallback_reason: null,
  };
}
