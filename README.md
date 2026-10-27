# A6 — Refund Request Risk Classifier

A small AI decision capability for a software platform, built on a typed **Jev** decision. It classifies refund requests into:

- `INSTANT_AUTO_APPROVE`
- `MANUAL_INSPECTION_REQUIRED`
- `FRAUD_RISK_FLAG`

The model supplies a typed choice with probabilities. The application validates the result and applies deterministic guardrails. Any invalid result, timeout, or failure routes to `MANUAL_INSPECTION_REQUIRED`.

## Requirements

- Node.js 26+ (native TypeScript execution; no build step)
- No runtime dependencies
- Dev dependencies: `typescript`, `@types/node` (typecheck only)

## Commands

```bash
npm install
npm test          # unit tests for validation, guardrails, fallback
npm run typecheck # tsc --noEmit
npm run demo      # offline fallback demo -> logs/fallback-demo.log
```

The demo uses mocked Jev responses, so it does **not** call the model and does not need an API key.

## Layout

| Path | Purpose |
|---|---|
| `A6_submission.md` | Filled report (export to `A6_StudentID.pdf`) |
| `config/jev-questions.json` | Playground question definitions and criteria |
| `config/test-cases.json` | Six synthetic test inputs with expected decisions |
| `src/types.ts` | Request/result/Jev response types |
| `src/validate.ts` | Input and output schema validation |
| `src/policy.ts` | Confidence, high-value, and fraud-signal guardrails |
| `src/jevClient.ts` | Transport interface + optional HTTP transport |
| `src/classifyRefund.ts` | Orchestrator with deterministic fallback |
| `src/fallbackDemo.ts` | Executable fallback demonstration |
| `test/classifyRefund.test.ts` | 12 unit tests |
| `docs/architecture.svg` | Integration architecture diagram |
| `docs/api-examples.md` | Request/response JSON |
| `docs/playground-runbook.md` | Paste-ready cases + evidence capture |
| `logs/fallback-demo.log` | Generated evidence for the fallback demo |

## Model evidence

The assignment uses the **Jev Playground**. The six cases in `docs/playground-runbook.md` have been run and the results are recorded there and in `A6_submission.md` Section 2. Optional screenshots belong in `docs/evidence/`.

## Optional production wiring

`src/jevClient.ts` includes an HTTP transport. To use it, set the endpoint and key in server-side environment variables:

```text
JEV_ENDPOINT=https://openrouter.ai/api/alpha/decisions
JEV_API_KEY=<server-side secret>
```

Never put the key in browser code, the report, or the repository. The Playground path is sufficient for this assignment; the HTTP transport exists to show how the same typed request would run in production.

## Guardrails

| Condition | Result |
|---|---|
| Input schema invalid | `MANUAL_INSPECTION_REQUIRED` / `INVALID_INPUT` |
| Timeout (4 s) | `MANUAL_INSPECTION_REQUIRED` / `TIMEOUT` |
| Network error, 5xx, 429 | `MANUAL_INSPECTION_REQUIRED` / `SERVICE_UNAVAILABLE` |
| Malformed JSON | `MANUAL_INSPECTION_REQUIRED` / `MALFORMED_RESPONSE` |
| Unknown choice, bad probabilities, missing fields | `MANUAL_INSPECTION_REQUIRED` / `INVALID_OUTPUT` |
| `confidence < 0.55` on an auto-approval | `MANUAL_INSPECTION_REQUIRED` / `LOW_CONFIDENCE` |
| `order_value > 500` on an auto-approval | `MANUAL_INSPECTION_REQUIRED` / `HIGH_VALUE_OVERRIDE` |
| `fraud_signal >= 0.80` on an auto-approval | `MANUAL_INSPECTION_REQUIRED` / `FRAUD_SIGNAL_OVERRIDE` |
| Model returns `FRAUD_RISK_FLAG` | Preserved and routed to the fraud team |
