import type { DecisionTransport } from "./jevClient.ts";
import { JEV_MODEL } from "./jevConfig.ts";
import { POLICY, applyPolicy } from "./policy.ts";
import type { FallbackReason, RiskResult } from "./types.ts";
import { validateJevResponse, validateRefundRequest } from "./validate.ts";

export interface ClassifyOptions {
  timeoutMs?: number;
  model?: string;
}

export async function classifyRefund(
  input: unknown,
  transport: DecisionTransport,
  options: ClassifyOptions = {},
): Promise<RiskResult> {
  const requestId = extractRequestId(input);
  const model = options.model ?? JEV_MODEL;
  const validation = validateRefundRequest(input);

  if (!validation.ok) {
    return fallbackResult(requestId, "INVALID_INPUT", model);
  }

  const request = validation.value;
  const timeoutMs = options.timeoutMs ?? POLICY.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let raw: unknown;
  try {
    raw = await transport.decide(request, controller.signal);
  } catch (error) {
    const reason: FallbackReason = isTimeout(error, controller.signal)
      ? "TIMEOUT"
      : error instanceof SyntaxError
        ? "MALFORMED_RESPONSE"
        : "SERVICE_UNAVAILABLE";
    return fallbackResult(request.request_id, reason, model);
  } finally {
    clearTimeout(timer);
  }

  const output = validateJevResponse(raw);
  if (!output.ok) {
    return fallbackResult(request.request_id, "INVALID_OUTPUT", model);
  }

  const { modelDecision, confidence, probabilities, fraudSignal } = output.value;
  const policy = applyPolicy(request, modelDecision, confidence, fraudSignal);

  return {
    request_id: request.request_id,
    decision: policy.decision,
    model_decision: modelDecision,
    confidence,
    probabilities,
    fraud_signal: fraudSignal,
    fallback_used: policy.fallback_used,
    fallback_reason: policy.fallback_reason,
    model,
  };
}

function isTimeout(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) {
    return true;
  }

  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function extractRequestId(input: unknown): string {
  if (typeof input === "object" && input !== null && "request_id" in input) {
    const requestId = (input as { request_id?: unknown }).request_id;
    if (typeof requestId === "string" && requestId.length > 0) {
      return requestId;
    }
  }

  return "unknown";
}

function fallbackResult(
  requestId: string,
  reason: FallbackReason,
  model: string,
): RiskResult {
  return {
    request_id: requestId,
    decision: "MANUAL_INSPECTION_REQUIRED",
    model_decision: null,
    confidence: 0,
    probabilities: {},
    fraud_signal: null,
    fallback_used: true,
    fallback_reason: reason,
    model,
  };
}
