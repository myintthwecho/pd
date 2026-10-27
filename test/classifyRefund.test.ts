import assert from "node:assert/strict";
import test from "node:test";
import { classifyRefund } from "../src/classifyRefund.ts";
import type { DecisionTransport } from "../src/jevClient.ts";
import { caseById, TEST_CASES } from "../src/testCases.ts";
import { DECISIONS, type RiskDecision } from "../src/types.ts";
import { validateJevResponse, validateRefundRequest } from "../src/validate.ts";

function probabilitiesFor(
  choice: RiskDecision,
  probability = 0.9,
): Record<string, number> {
  const remainder = (1 - probability) / (DECISIONS.length - 1);
  const result: Record<string, number> = {};
  for (const decision of DECISIONS) {
    result[decision] = decision === choice ? probability : remainder;
  }
  return result;
}

function jevResponse(
  choice: RiskDecision,
  confidence = 0.9,
  fraudSignal = 0.05,
  probability = 0.9,
): unknown {
  return {
    answers: {
      refund_risk: {
        choice,
        probabilities: probabilitiesFor(choice, probability),
        confidence,
      },
      fraud_signal: { noul: fraudSignal },
    },
  };
}

function fixed(value: unknown): DecisionTransport {
  return { decide: async () => value };
}

test("all fixture inputs pass validation", () => {
  for (const testCase of TEST_CASES) {
    const result = validateRefundRequest(testCase.request);
    assert.equal(result.ok, true, `${testCase.id} should be valid`);
  }
});

test("low-risk damaged claim is auto-approved", async () => {
  const request = caseById("T1").request;
  const result = await classifyRefund(
    request,
    fixed(jevResponse("INSTANT_AUTO_APPROVE")),
  );

  assert.equal(result.decision, "INSTANT_AUTO_APPROVE");
  assert.equal(result.model_decision, "INSTANT_AUTO_APPROVE");
  assert.equal(result.fallback_used, false);
  assert.equal(result.fallback_reason, null);
});

test("high-value auto-approval is overridden to manual inspection", async () => {
  const request = caseById("T4").request;
  const result = await classifyRefund(
    request,
    fixed(jevResponse("INSTANT_AUTO_APPROVE", 0.95)),
  );

  assert.equal(result.decision, "MANUAL_INSPECTION_REQUIRED");
  assert.equal(result.model_decision, "INSTANT_AUTO_APPROVE");
  assert.equal(result.fallback_used, true);
  assert.equal(result.fallback_reason, "HIGH_VALUE_OVERRIDE");
});

test("high fraud signal overrides auto-approval", async () => {
  const request = caseById("T2").request;
  const result = await classifyRefund(
    request,
    fixed(jevResponse("INSTANT_AUTO_APPROVE", 0.8, 0.92)),
  );

  assert.equal(result.decision, "MANUAL_INSPECTION_REQUIRED");
  assert.equal(result.fallback_reason, "FRAUD_SIGNAL_OVERRIDE");
});

test("low confidence overrides auto-approval", async () => {
  const request = caseById("T1").request;
  const result = await classifyRefund(
    request,
    fixed(jevResponse("INSTANT_AUTO_APPROVE", 0.5, 0.05, 0.5)),
  );

  assert.equal(result.decision, "MANUAL_INSPECTION_REQUIRED");
  assert.equal(result.fallback_reason, "LOW_CONFIDENCE");
});

test("fraud decision is preserved", async () => {
  const request = caseById("T5").request;
  const result = await classifyRefund(
    request,
    fixed(jevResponse("FRAUD_RISK_FLAG", 0.93, 0.95)),
  );

  assert.equal(result.decision, "FRAUD_RISK_FLAG");
  assert.equal(result.fallback_used, false);
});

test("unknown choice falls back to manual inspection", async () => {
  const request = caseById("T1").request;
  const result = await classifyRefund(
    request,
    fixed(jevResponse("APPROVE" as RiskDecision)),
  );

  assert.equal(result.decision, "MANUAL_INSPECTION_REQUIRED");
  assert.equal(result.fallback_used, true);
  assert.equal(result.fallback_reason, "INVALID_OUTPUT");
});

test("probabilities that do not sum to one are rejected", () => {
  const result = validateJevResponse({
    answers: {
      refund_risk: {
        choice: "INSTANT_AUTO_APPROVE",
        probabilities: {
          INSTANT_AUTO_APPROVE: 0.9,
          MANUAL_INSPECTION_REQUIRED: 0.9,
          FRAUD_RISK_FLAG: 0.9,
        },
        confidence: 0.9,
      },
      fraud_signal: { noul: 0.1 },
    },
  });

  assert.equal(result.ok, false);
});

test("timeout falls back to manual inspection", async () => {
  const request = caseById("T1").request;
  const neverResolves: DecisionTransport = {
    decide: (_request, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
  };

  const result = await classifyRefund(request, neverResolves, { timeoutMs: 20 });

  assert.equal(result.decision, "MANUAL_INSPECTION_REQUIRED");
  assert.equal(result.fallback_reason, "TIMEOUT");
});

test("network failure falls back to manual inspection", async () => {
  const request = caseById("T1").request;
  const unavailable: DecisionTransport = {
    decide: async () => {
      throw new Error("ECONNREFUSED");
    },
  };

  const result = await classifyRefund(request, unavailable);

  assert.equal(result.decision, "MANUAL_INSPECTION_REQUIRED");
  assert.equal(result.fallback_reason, "SERVICE_UNAVAILABLE");
});

test("malformed JSON falls back to manual inspection", async () => {
  const request = caseById("T1").request;
  const malformed: DecisionTransport = {
    decide: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  };

  const result = await classifyRefund(request, malformed);

  assert.equal(result.decision, "MANUAL_INSPECTION_REQUIRED");
  assert.equal(result.fallback_reason, "MALFORMED_RESPONSE");
});

test("invalid input is rejected without calling the model", async () => {
  let called = false;
  const transport: DecisionTransport = {
    decide: async () => {
      called = true;
      return jevResponse("INSTANT_AUTO_APPROVE");
    },
  };

  const result = await classifyRefund(
    { ...caseById("T1").request, order_value: -5 },
    transport,
  );

  assert.equal(called, false);
  assert.equal(result.decision, "MANUAL_INSPECTION_REQUIRED");
  assert.equal(result.fallback_reason, "INVALID_INPUT");
});
