import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classifyRefund } from "./classifyRefund.ts";
import type { DecisionTransport } from "./jevClient.ts";
import { caseById } from "./testCases.ts";
import { DECISIONS, type RiskDecision } from "./types.ts";

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

const timeoutTransport: DecisionTransport = {
  decide: (_request, signal) =>
    new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }),
};

const unavailableTransport: DecisionTransport = {
  decide: async () => {
    throw new Error("ECONNREFUSED");
  },
};

const malformedTransport: DecisionTransport = {
  decide: async () => {
    throw new SyntaxError("Unexpected token < in JSON");
  },
};

interface Scenario {
  name: string;
  requestId: string;
  transport: DecisionTransport;
  options?: { timeoutMs?: number };
}

const scenarios: Scenario[] = [
  {
    name: "model auto-approves a low-risk claim",
    requestId: "T1",
    transport: fixed(jevResponse("INSTANT_AUTO_APPROVE", 0.92, 0.03)),
  },
  {
    name: "high-value override on a $2400 claim",
    requestId: "T4",
    transport: fixed(jevResponse("INSTANT_AUTO_APPROVE", 0.95)),
  },
  {
    name: "fraud-signal override on an auto-approval",
    requestId: "T2",
    transport: fixed(jevResponse("INSTANT_AUTO_APPROVE", 0.8, 0.92)),
  },
  {
    name: "model flags fraud",
    requestId: "T5",
    transport: fixed(jevResponse("FRAUD_RISK_FLAG", 0.93, 0.96)),
  },
  {
    name: "low confidence auto-approval",
    requestId: "T1",
    transport: fixed(jevResponse("INSTANT_AUTO_APPROVE", 0.5, 0.05, 0.5)),
  },
  {
    name: "invalid output (unknown choice)",
    requestId: "T1",
    transport: fixed(jevResponse("APPROVE" as RiskDecision)),
  },
  {
    name: "timeout",
    requestId: "T1",
    transport: timeoutTransport,
    options: { timeoutMs: 25 },
  },
  {
    name: "service unavailable",
    requestId: "T1",
    transport: unavailableTransport,
  },
  {
    name: "malformed JSON response",
    requestId: "T1",
    transport: malformedTransport,
  },
  {
    name: "invalid input rejected before the model call",
    requestId: "T1",
    transport: fixed(jevResponse("INSTANT_AUTO_APPROVE")),
    options: {},
  },
];

const logEntries: unknown[] = [];

console.log("A6 Refund Risk Classifier - deterministic fallback demo");
console.log(`Node ${process.version}`);
console.log("");

for (const [index, scenario] of scenarios.entries()) {
  const request = caseById(scenario.requestId).request;
  const input =
    index === scenarios.length - 1 ? { ...request, order_value: -5 } : request;

  const result = await classifyRefund(input, scenario.transport, scenario.options);

  logEntries.push({ scenario: scenario.name, result });

  console.log(`${index + 1}. ${scenario.name}`);
  console.log(
    `   request=${result.request_id} model_decision=${result.model_decision ?? "none"} final=${result.decision}`,
  );
  console.log(
    `   fallback_used=${result.fallback_used} reason=${result.fallback_reason ?? "none"}`,
  );
  console.log("");
}

const log = {
  generated_at: new Date().toISOString(),
  node: process.version,
  policy: {
    confidence_min: 0.55,
    high_value_threshold: 500,
    fraud_signal_min: 0.8,
    timeout_ms: 4000,
  },
  scenarios: logEntries,
};

mkdirSync(join(process.cwd(), "logs"), { recursive: true });
const logPath = join(process.cwd(), "logs", "fallback-demo.log");
writeFileSync(logPath, `${JSON.stringify(log, null, 2)}\n`, "utf8");

console.log(`Fallback demo log written to ${logPath}`);
