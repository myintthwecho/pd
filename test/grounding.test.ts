import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { classifyRefund } from "../src/classifyRefund.ts";
import type { EvaluationDataset } from "../src/evaluation.ts";
import { buildJevRequest } from "../src/jevConfig.ts";
import type { DecisionTransport } from "../src/jevClient.ts";
import { retrievePolicy } from "../src/retrieval.ts";
import {
  DECISIONS,
  type GroundedRefundRequest,
  type RefundRequest,
  type RiskDecision,
} from "../src/types.ts";
import { validateRefundRequest } from "../src/validate.ts";

const dataset = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../eval-cases.json", import.meta.url)),
    "utf8",
  ),
) as EvaluationDataset;

function requestFor(id: string): RefundRequest {
  const testCase = dataset.cases.find((candidate) => candidate.id === id);
  assert.ok(testCase, `missing case ${id}`);
  const validation = validateRefundRequest(testCase.input);
  assert.equal(validation.ok, true, `case ${id} input should be valid`);
  return validation.value;
}

function validResponse(choice: RiskDecision = "INSTANT_AUTO_APPROVE"): unknown {
  const remainder = (1 - 0.9) / (DECISIONS.length - 1);
  const probabilities: Record<string, number> = {};
  for (const decision of DECISIONS) {
    probabilities[decision] = decision === choice ? 0.9 : remainder;
  }
  return {
    answers: {
      refund_risk: { choice, probabilities, confidence: 0.9 },
      fraud_signal: { noul: 0.05 },
    },
  };
}

test("baseline request has no policy_context", () => {
  const request = requestFor("T04");
  const payload = buildJevRequest(request);
  assert.equal("policy_context" in payload.state, false);
});

test("grounding adds only policy_context and keeps questions identical", () => {
  const request = requestFor("T04");
  const records = retrievePolicy(request);
  assert.ok(records.length > 0);

  const baseline = buildJevRequest(request);
  const grounded = buildJevRequest({ ...request, policy_context: records });

  assert.deepEqual(grounded.questions, baseline.questions);

  const groundedState = grounded.state as Record<string, unknown>;
  const { policy_context: policyContext, ...rest } = groundedState;
  assert.deepEqual(rest, baseline.state);
  assert.deepEqual(policyContext, records);
});

test("classifyRefund forwards grounding to the transport", async () => {
  const request = requestFor("T04");
  const records = retrievePolicy(request);
  const captured: { value: GroundedRefundRequest | null } = { value: null };

  const transport: DecisionTransport = {
    decide: async (state) => {
      captured.value = state as GroundedRefundRequest;
      return validResponse();
    },
  };

  const result = await classifyRefund(request, transport, {
    grounding: records,
  });

  assert.equal(result.decision, "INSTANT_AUTO_APPROVE");
  assert.ok(captured.value);
  assert.deepEqual(captured.value.policy_context, records);
});

test("classifyRefund without grounding sends no policy_context", async () => {
  const request = requestFor("T04");
  const captured: { value: RefundRequest | null } = { value: null };

  const transport: DecisionTransport = {
    decide: async (state) => {
      captured.value = state;
      return validResponse();
    },
  };

  await classifyRefund(request, transport);

  assert.ok(captured.value);
  assert.equal("policy_context" in captured.value, false);
});
