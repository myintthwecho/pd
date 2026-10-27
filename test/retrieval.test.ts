import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { KNOWLEDGE_RECORDS, retrievePolicy } from "../src/retrieval.ts";
import type { EvaluationDataset } from "../src/evaluation.ts";
import { validateRefundRequest } from "../src/validate.ts";
import type { RefundRequest } from "../src/types.ts";

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

test("knowledge base has at least five unique records", () => {
  assert.ok(KNOWLEDGE_RECORDS.length >= 5);
  const ids = new Set(KNOWLEDGE_RECORDS.map((record) => record.id));
  assert.equal(ids.size, KNOWLEDGE_RECORDS.length);
  for (const record of KNOWLEDGE_RECORDS) {
    assert.ok(record.policy.length > 0, `${record.id} should have policy text`);
  }
});

test("non-delivery case retrieves the non-delivery policy", () => {
  const records = retrievePolicy(requestFor("T04"));
  assert.ok(records.some((record) => record.id === "POL-NONDELIVERY"));
});

test("change-of-mind case retrieves the return-window policy", () => {
  const records = retrievePolicy(requestFor("T05"));
  assert.ok(records.some((record) => record.id === "POL-RETURN-WINDOW"));
});

test("high-value case retrieves the high-value policy", () => {
  const records = retrievePolicy(requestFor("T06"));
  assert.ok(records.some((record) => record.id === "POL-HIGH-VALUE"));
  assert.ok(records.some((record) => record.id === "POL-NOT-AS-DESCRIBED"));
});

test("repeated-refund case retrieves the fraud policy", () => {
  const records = retrievePolicy(requestFor("T09"));
  assert.ok(records.some((record) => record.id === "POL-REPEATED-REFUND"));
});

test("duplicate-charge and not-as-described cases retrieve their policies", () => {
  assert.ok(
    retrievePolicy(requestFor("T02")).some(
      (record) => record.id === "POL-DUPLICATE",
    ),
  );
  assert.ok(
    retrievePolicy(requestFor("T03")).some(
      (record) => record.id === "POL-NOT-AS-DESCRIBED",
    ),
  );
});

test("low-value condition alone does not retrieve an unrelated policy", () => {
  const damaged = retrievePolicy(requestFor("T01")).map((record) => record.id);
  assert.deepEqual(damaged, ["POL-DAMAGED"]);

  const nonDelivery = retrievePolicy(requestFor("T04")).map(
    (record) => record.id,
  );
  assert.ok(nonDelivery.includes("POL-NONDELIVERY"));
  assert.equal(nonDelivery.includes("POL-DAMAGED"), false);
  assert.equal(nonDelivery.includes("POL-DUPLICATE"), false);
});

test("retrieval is deterministic, capped, and only returns positive scores", () => {
  const request = requestFor("T06");
  const first = retrievePolicy(request);
  const second = retrievePolicy(request);

  assert.deepEqual(first, second);
  assert.ok(first.length <= 3);
  for (const record of first) {
    assert.ok(record.score > 0);
    assert.ok(record.matched.length > 0);
  }
});
