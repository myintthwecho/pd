# Jev Playground runbook

Use this to produce the **actual model execution evidence** for Task 2. The Playground pins `typesafe/jev-1.13`; the request shape matches `config/jev-questions.json`.

## Setup (once)

1. Open <https://jevaimodel.dev/playground> (or <https://jevai.dev/playground>).
2. Add **Question 1**:
   - ID: `refund_risk`
   - Type: `choice`
   - Instructions and criteria: copy from `config/jev-questions.json`.
3. Add **Question 2**:
   - ID: `fraud_signal`
   - Type: `noul`
   - Instructions and criteria: copy from `config/jev-questions.json`.
4. Keep the model at the Playground default (`typesafe/jev-1.13`).
5. Run the six cases below **in one session**. The free tier allows six attempts per UTC day; resets at 00:00 UTC.
6. For each run, save a screenshot to `docs/evidence/T<number>.png` and fill the capture table.

> If the Playground offers a JSON state mode, paste the corresponding `request` object from `config/test-cases.json` instead of the text block. Both contain the same synthetic data.

## Case T1 — damaged on arrival, low value

```text
request_id: T1
order_id: ORD-1001
order_value: 48 USD
days_since_delivery: 2
prior_refund_count_30d: 0
claim_reason: damaged_on_arrival
claim_text: The ceramic mug arrived in pieces. The box was crushed on one side and there is a photo of the damage attached to the ticket. I would like a refund for this order.
```

Expected: `INSTANT_AUTO_APPROVE`

## Case T2 — non-delivery, tracking stalled, low value

```text
request_id: T2
order_id: ORD-1002
order_value: 65 USD
days_since_delivery: not delivered
prior_refund_count_30d: 0
claim_reason: not_delivered
claim_text: The tracking page has not moved for 21 days and the carrier says the parcel is delayed. The order never arrived and I still need it. Please refund me so I can order again.
```

Expected: `INSTANT_AUTO_APPROVE`

## Case T3 — change of mind, used item, outside return window

```text
request_id: T3
order_id: ORD-1003
order_value: 120 USD
days_since_delivery: 40
prior_refund_count_30d: 0
claim_reason: changed_mind
claim_text: I bought these shoes last month and wore them twice. They are fine but I changed my mind and would prefer the money back. Can I return them?
```

Expected: `MANUAL_INSPECTION_REQUIRED`

## Case T4 — high-value custom item, not as described

```text
request_id: T4
order_id: ORD-1004
order_value: 2400 USD
days_since_delivery: 5
prior_refund_count_30d: 0
claim_reason: not_as_described
claim_text: The custom sofa does not match the fabric sample I approved. The colour is much darker and the stitching is uneven. For this price I expected the agreed specification, so I want a full refund.
```

Expected: `MANUAL_INSPECTION_REQUIRED` (also exercises the high-value override if the raw choice is AUTO)

## Case T5 — repeated refunds, delivered tracking, dispute threat

```text
request_id: T5
order_id: ORD-1005
order_value: 89 USD
days_since_delivery: 6
prior_refund_count_30d: 4
claim_reason: not_delivered
claim_text: This is my fourth refund request this month. The tracking says the parcel was delivered and signed for, but I never received it. I want the money back immediately or I will dispute the charge.
```

Expected: `FRAUD_RISK_FLAG`

## Case T6 — abusive language, no evidence, prior refunds

```text
request_id: T6
order_id: ORD-1006
order_value: 310 USD
days_since_delivery: 14
prior_refund_count_30d: 2
claim_reason: other
claim_text: I am not giving you any more details. You people are useless and I am not waiting any longer. Refund me now or I will keep complaining everywhere.
```

Expected: `MANUAL_INSPECTION_REQUIRED`

## Capture table (recorded run)

| Case | Raw choice | Probabilities (Auto / Manual / Fraud) | Confidence | Fraud noul (yes) | Final after guardrails | Pass/Fail | Screenshot |
|---|---|---|---|---|---|---|---|
| T1 | `INSTANT_AUTO_APPROVE` | 81% / 18% / 1% | not captured | 5% | `INSTANT_AUTO_APPROVE` | Pass | `docs/evidence/T1.png` |
| T2 | `MANUAL_INSPECTION_REQUIRED` | 43% / 56% / 1% | not captured | 7% | `MANUAL_INSPECTION_REQUIRED` | Mismatch (safe) | `docs/evidence/T2.png` |
| T3 | `MANUAL_INSPECTION_REQUIRED` | 48% / 51% / 1% | not captured | 8% | `MANUAL_INSPECTION_REQUIRED` | Pass | `docs/evidence/T3.png` |
| T4 | `MANUAL_INSPECTION_REQUIRED` | 5% / 95% / 0% | not captured | 8% | `MANUAL_INSPECTION_REQUIRED` | Pass | `docs/evidence/T4.png` |
| T5 | `FRAUD_RISK_FLAG` | 0% / 11% / 89% | not captured | 56% | `FRAUD_RISK_FLAG` | Pass | `docs/evidence/T5.png` |
| T6 | `MANUAL_INSPECTION_REQUIRED` | 34% / 58% / 8% | not captured | 31% | `MANUAL_INSPECTION_REQUIRED` | Pass | `docs/evidence/T6.png` |

## Notes

- Record the **raw** Jev choice first, then the final decision after the app's guardrails.
- If a run fails or the output is incomplete, write down exactly what happened. That is useful evidence for the fallback design and the reflection.
- Do not paste real customer names, addresses, emails, phone numbers, or order data. All cases above are synthetic.
- Never include an API key or access token in the report or screenshots.
