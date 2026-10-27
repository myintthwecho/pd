import testCaseData from "../config/test-cases.json" with { type: "json" };
import type { RefundRequest, RiskDecision } from "./types.ts";

export interface TestCase {
  id: string;
  scenario: string;
  expected: RiskDecision;
  request: RefundRequest;
}

const data = testCaseData as { cases: TestCase[] };

export const TEST_CASES: TestCase[] = data.cases;

export function caseById(id: string): TestCase {
  const testCase = TEST_CASES.find((candidate) => candidate.id === id);
  if (!testCase) {
    throw new Error(`Unknown test case: ${id}`);
  }
  return testCase;
}
