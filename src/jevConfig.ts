import type { GroundedRefundRequest } from "./types.ts";

export const JEV_MODEL = "typesafe/jev-1.13";

export type DecisionState = GroundedRefundRequest;

export const jevQuestions = {
  refund_risk: {
    type: "choice",
    instructions:
      "Classify the refund request into exactly one risk decision. Prefer MANUAL_INSPECTION_REQUIRED when the claim is ambiguous, incomplete, high value, or lacks verifiable detail. Use FRAUD_RISK_FLAG only when the narrative shows deliberate bad-faith exploitation, such as repeated refunds, contradictory tracking evidence, or threats to dispute a delivered order.",
    criteria: {
      INSTANT_AUTO_APPROVE:
        "Genuine, low-risk claim that matches a normal refund policy; a refund can be issued without human review.",
      MANUAL_INSPECTION_REQUIRED:
        "Ambiguous, incomplete, high-value, or otherwise requires a human to inspect evidence before a refund decision.",
      FRAUD_RISK_FLAG:
        "Signals of deliberate bad-faith exploitation of the refund process rather than genuine dissatisfaction.",
    },
  },
  fraud_signal: {
    type: "noul",
    instructions:
      "Does the claim show deliberate bad-faith refund exploitation rather than a genuine customer problem?",
    criteria: {
      false: "No deliberate fraud signal",
      true: "Deliberate fraud signal present",
    },
  },
} as const;

export function buildJevRequest(request: DecisionState) {
  const { policy_context: policyContext, ...baseState } = request;
  const state =
    policyContext && policyContext.length > 0
      ? { ...baseState, policy_context: policyContext }
      : baseState;

  return {
    model: JEV_MODEL,
    state,
    questions: jevQuestions,
  };
}
