import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  scoreCase,
  summarize,
  validateDataset,
  type EvaluationCase,
  type EvaluationDataset,
} from "../src/evaluation.ts";
import { validateRefundRequest } from "../src/validate.ts";

const raw = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../eval-cases.json", import.meta.url)),
    "utf8",
  ),
) as unknown;

const validation = validateDataset(raw);
assert.equal(validation.ok, true);
const dataset = (validation as { ok: true; value: EvaluationDataset }).value;

function caseById(id: string): EvaluationCase {
  const testCase = dataset.cases.find((candidate) => candidate.id === id);
  assert.ok(testCase, `missing case ${id}`);
  return testCase;
}

test("dataset is preregistered with the required case mix", () => {
  assert.equal(dataset.preregistered, true);
  assert.equal(dataset.cases.length, 10);

  const counts: Record<string, number> = {};
  for (const testCase of dataset.cases) {
    counts[testCase.case_type] = (counts[testCase.case_type] ?? 0) + 1;
  }
  assert.deepEqual(counts, {
    normal: 3,
    edge: 3,
    fallback: 2,
    difficult: 2,
  });
});

test("fallback cases declare fault injection and expected fallback reasons", () => {
  assert.equal(caseById("T07").fault, "invalid_input");
  assert.equal(caseById("T07").expected_fallback_reason, "INVALID_INPUT");
  assert.equal(caseById("T07").check_fallback_reason, true);

  assert.equal(caseById("T08").fault, "timeout");
  assert.equal(caseById("T08").expected_fallback_reason, "TIMEOUT");
  assert.equal(caseById("T08").check_fallback_reason, true);
});

test("model cases have valid inputs; the invalid-input case is rejected", () => {
  for (const testCase of dataset.cases) {
    if (!testCase.model_required) {
      continue;
    }
    const result = validateRefundRequest(testCase.input);
    assert.equal(result.ok, true, `${testCase.id} should be valid`);
  }

  const invalid = validateRefundRequest(caseById("T07").input);
  assert.equal(invalid.ok, false);
});

test("scoreCase handles pass, fail, fallback mismatch, and pending", () => {
  const testCase = caseById("T01");
  const pass = scoreCase(
    testCase,
    "INSTANT_AUTO_APPROVE",
    null,
    "policy_replay",
    100,
    "recorded",
  );
  assert.equal(pass.status, "pass");

  const fail = scoreCase(
    testCase,
    "MANUAL_INSPECTION_REQUIRED",
    null,
    "policy_replay",
    100,
    "recorded",
  );
  assert.equal(fail.status, "fail");

  const fallback = caseById("T07");
  const fallbackMismatch = scoreCase(
    fallback,
    "MANUAL_INSPECTION_REQUIRED",
    "TIMEOUT",
    "deterministic_fallback",
    null,
    "local_replay",
  );
  assert.equal(fallbackMismatch.status, "fail");

  const pending = scoreCase(testCase, null, null, null, null, "not_available");
  assert.equal(pending.status, "pending");
});

test("summarize computes accuracy and nearest-rank p95 latency", () => {
  const results = [
    scoreCase(caseById("T01"), "INSTANT_AUTO_APPROVE", null, "policy_replay", 100, "recorded"),
    scoreCase(caseById("T02"), "INSTANT_AUTO_APPROVE", null, "policy_replay", 200, "recorded"),
    scoreCase(caseById("T03"), "INSTANT_AUTO_APPROVE", null, "policy_replay", 300, "recorded"),
    scoreCase(caseById("T04"), "INSTANT_AUTO_APPROVE", null, "policy_replay", 400, "recorded"),
    scoreCase(caseById("T05"), "MANUAL_INSPECTION_REQUIRED", null, "policy_replay", 500, "recorded"),
  ];

  const summary = summarize({
    version: "baseline",
    results,
    gitSha: "test",
    configSha: "test",
  });

  assert.equal(summary.correct, 5);
  assert.equal(summary.accuracy_completed_pct, 100);
  assert.equal(summary.latency.samples, 5);
  assert.equal(summary.latency.p50_ms, 300);
  assert.equal(summary.latency.p95_ms, 500);
});
