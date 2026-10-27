import knowledgeData from "../knowledge/refund-policy.json" with { type: "json" };
import type {
  PolicyRecord,
  RefundRequest,
  RetrievedPolicy,
} from "./types.ts";

const KNOWLEDGE = (knowledgeData as { records: PolicyRecord[] }).records;

export const KNOWLEDGE_RECORDS: readonly PolicyRecord[] = KNOWLEDGE;

const DEFAULT_LIMIT = 3;
const MAX_KEYWORD_HITS = 5;

export function retrievePolicy(
  request: RefundRequest,
  limit = DEFAULT_LIMIT,
): RetrievedPolicy[] {
  const claimText = request.claim_text.toLowerCase();

  const scored = KNOWLEDGE.map((record) => scoreRecord(record, request, claimText))
    .filter((record) => record.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.id.localeCompare(right.id);
    });

  return scored.slice(0, limit);
}

function scoreRecord(
  record: PolicyRecord,
  request: RefundRequest,
  claimText: string,
): RetrievedPolicy {
  const conditions = record.applies_when;
  const matched: string[] = [];
  let primaryScore = 0;

  if (conditions.claim_reasons?.includes(request.claim_reason)) {
    primaryScore += 5;
    matched.push(`claim_reason:${request.claim_reason}`);
  }

  let keywordHits = 0;
  for (const keyword of conditions.keywords ?? []) {
    if (keywordHits >= MAX_KEYWORD_HITS) {
      break;
    }
    if (claimText.includes(keyword.toLowerCase())) {
      keywordHits += 1;
      primaryScore += 1;
      matched.push(`keyword:${keyword}`);
    }
  }

  if (
    conditions.min_order_value !== undefined &&
    request.order_value >= conditions.min_order_value
  ) {
    primaryScore += 3;
    matched.push(`order_value>=${conditions.min_order_value}`);
  }

  if (
    conditions.min_prior_refund_count_30d !== undefined &&
    request.prior_refund_count_30d >= conditions.min_prior_refund_count_30d
  ) {
    primaryScore += 2;
    matched.push(
      `prior_refund_count_30d>=${conditions.min_prior_refund_count_30d}`,
    );
  }

  if (primaryScore === 0) {
    return { ...record, score: 0, matched: [] };
  }

  let score = primaryScore;

  if (
    conditions.max_order_value !== undefined &&
    request.order_value <= conditions.max_order_value
  ) {
    score += 2;
    matched.push(`order_value<=${conditions.max_order_value}`);
  }

  if (
    conditions.min_days_since_delivery !== undefined &&
    request.days_since_delivery !== null &&
    request.days_since_delivery >= conditions.min_days_since_delivery
  ) {
    score += 2;
    matched.push(`days_since_delivery>=${conditions.min_days_since_delivery}`);
  }

  if (
    conditions.max_days_since_delivery !== undefined &&
    request.days_since_delivery !== null &&
    request.days_since_delivery <= conditions.max_days_since_delivery
  ) {
    score += 2;
    matched.push(`days_since_delivery<=${conditions.max_days_since_delivery}`);
  }

  return { ...record, score, matched };
}
