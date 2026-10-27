# API request and response examples

These examples use the same typed decision that the Playground runs. The production endpoint can be the Jev API or OpenRouter Decisions API; the Playground uses the same request shape with `state.input` rendered as text.

## 1. Request

```json
{
  "model": "typesafe/jev-1.13",
  "state": {
    "request_id": "T1",
    "order_id": "ORD-1001",
    "order_value": 48,
    "currency": "USD",
    "days_since_delivery": 2,
    "prior_refund_count_30d": 0,
    "claim_reason": "damaged_on_arrival",
    "claim_text": "The ceramic mug arrived in pieces. The box was crushed on one side and there is a photo of the damage attached to the ticket. I would like a refund for this order."
  },
  "questions": {
    "refund_risk": {
      "type": "choice",
      "instructions": "Classify the refund request into exactly one risk decision. Prefer MANUAL_INSPECTION_REQUIRED when the claim is ambiguous, incomplete, high value, or lacks verifiable detail. Use FRAUD_RISK_FLAG only when the narrative shows deliberate bad-faith exploitation, such as repeated refunds, contradictory tracking evidence, or threats to dispute a delivered order.",
      "criteria": {
        "INSTANT_AUTO_APPROVE": "Genuine, low-risk claim that matches a normal refund policy; a refund can be issued without human review.",
        "MANUAL_INSPECTION_REQUIRED": "Ambiguous, incomplete, high-value, or otherwise requires a human to inspect evidence before a refund decision.",
        "FRAUD_RISK_FLAG": "Signals of deliberate bad-faith exploitation of the refund process rather than genuine dissatisfaction."
      }
    },
    "fraud_signal": {
      "type": "noul",
      "instructions": "Does the claim show deliberate bad-faith refund exploitation rather than a genuine customer problem?",
      "criteria": {
        "false": "No deliberate fraud signal",
        "true": "Deliberate fraud signal present"
      }
    }
  }
}
```

## 2. Raw Jev response

```json
{
  "answers": {
    "refund_risk": {
      "choice": "INSTANT_AUTO_APPROVE",
      "probabilities": {
        "INSTANT_AUTO_APPROVE": 0.91,
        "MANUAL_INSPECTION_REQUIRED": 0.07,
        "FRAUD_RISK_FLAG": 0.02
      },
      "confidence": 0.88
    },
    "fraud_signal": {
      "noul": 0.03
    }
  }
}
```

## 3. Normalized application response

```json
{
  "request_id": "T1",
  "decision": "INSTANT_AUTO_APPROVE",
  "model_decision": "INSTANT_AUTO_APPROVE",
  "confidence": 0.88,
  "probabilities": {
    "INSTANT_AUTO_APPROVE": 0.91,
    "MANUAL_INSPECTION_REQUIRED": 0.07,
    "FRAUD_RISK_FLAG": 0.02
  },
  "fraud_signal": 0.03,
  "fallback_used": false,
  "fallback_reason": null,
  "model": "typesafe/jev-1.13"
}
```

## 4. Fallback response (model timeout)

```json
{
  "request_id": "T2",
  "decision": "MANUAL_INSPECTION_REQUIRED",
  "model_decision": null,
  "confidence": 0,
  "probabilities": {},
  "fraud_signal": null,
  "fallback_used": true,
  "fallback_reason": "TIMEOUT",
  "model": "typesafe/jev-1.13"
}
```

## 5. Policy-override response (high value)

```json
{
  "request_id": "T4",
  "decision": "MANUAL_INSPECTION_REQUIRED",
  "model_decision": "INSTANT_AUTO_APPROVE",
  "confidence": 0.95,
  "probabilities": {
    "INSTANT_AUTO_APPROVE": 0.95,
    "MANUAL_INSPECTION_REQUIRED": 0.025,
    "FRAUD_RISK_FLAG": 0.025
  },
  "fraud_signal": 0.05,
  "fallback_used": true,
  "fallback_reason": "HIGH_VALUE_OVERRIDE",
  "model": "typesafe/jev-1.13"
}
```
