# A7 Playground capture runbook

This runbook captures the **actual** Jev outputs needed for the A7 evaluation. Do not invent or edit model responses. The dataset and expected results are already preregistered in `eval-cases.json`.

## What is already recorded

The baseline includes the actual A6 Playground runs from `docs/playground-runbook.md`, plus new T02/T03 runs:

| A7 case | A6 case | Status |
|---|---|---|
| T01 | A6 T1 | Recorded; final decision reused |
| T04 | A6 T2 | Recorded; final decision reused (known mismatch) |
| T05 | A6 T3 | Recorded; final decision reused |
| T06 | A6 T4 | Recorded; final decision reused |
| T09 | A6 T5 | Recorded; final decision reused |
| T10 | A6 T6 | Recorded; final decision reused |
| T02 | New baseline run | Recorded; `q1`/`q2` normalized to `refund_risk`/`fraud_signal` |
| T03 | New baseline run | Recorded; `q1`/`q2` normalized to `refund_risk`/`fraud_signal` |
| T07 | — | Deterministic invalid-input fallback; no model run |
| T08 | — | Deterministic timeout fallback; no model run |

A6 did not capture the Playground `confidence` field. Those six baseline cases therefore use the recorded final decision and are marked `evaluated_by: recorded_final`. The report discloses this gap. The new T02/T03 baseline runs did capture confidence; their exact Playground responses are preserved as `raw_playground` in `eval/recorded/baseline.json`.

## What you need to run

| Arm | Cases | Runs remaining |
|---|---|---:|
| Baseline | none | 0 |
| Grounded | — | 0 |

All baseline runs are complete. The free Playground allowed six attempts per UTC day, so the
eight grounded runs were split over two days.

## Setup

1. Open the Jev Playground and select `typesafe/jev-1.13`.
2. Configure the two questions exactly as in `config/jev-questions.json`:
   - `refund_risk` — type `choice`
   - `fraud_signal` — type `noul`
   If the Playground assigns its own labels (`q1`, `q2`), keep the same instruction/criteria order and record the mapping (`q1` → `refund_risk`, `q2` → `fraud_signal`).
3. Keep the question instructions and criteria unchanged. The only difference between the two arms is the appended policy context.
4. Generate the paste-ready payloads:

```bash
npm run eval:print:baseline
npm run eval:print:grounded
```

The files are written to:

- `eval/payloads/baseline/T02.json`, `T03.json`
- `eval/payloads/grounded/T01.json` … `T10.json`

Each file contains the full request shape (`model`, `state`, `questions`). The free Jev Playground has a single **Context / state** text box and wraps the text under `state.input`, so paste the labeled text block for the case, not the JSON payload. The JSON payload is the equivalent structured request used by the harness/API. For grounded runs, append the `POLICY CONTEXT` section to the same text block. Keep the base text format identical across baseline and grounded; the only difference should be the appended policy context.

## Baseline runs (complete)

T02 and T03 are recorded. No baseline runs remain.

| Case | Expected decision | Screenshot to save | Raw JSON recorded? |
|---|---|---|---|
| T02 | `INSTANT_AUTO_APPROVE` | `docs/evidence/a7/T02-baseline.png` | [x] |
| T03 | `INSTANT_AUTO_APPROVE` | `docs/evidence/a7/T03-baseline.png` | [x] |

For each run, record:

- `refund_risk.choice`
- all three `refund_risk.probabilities`
- `refund_risk.confidence`
- `fraud_signal.noul`
- optional wall-clock milliseconds if the Playground displays a duration

The Playground may label the questions `q1` and `q2`; map `q1` to `refund_risk`, `q2.probability` to `fraud_signal.noul`, and the top-level `confidence.q1` to `refund_risk.confidence`. Preserve the original response in `raw_playground` when the harness needs a normalized `raw` object.

## Grounded runs (complete)

Run T01–T06 and T09–T10 using the labeled text blocks, with the case's `POLICY CONTEXT` section appended. The files in `eval/payloads/grounded/` are the structured equivalents; do not paste the JSON into the Playground text box.

| Case | Expected decision | Screenshot to save | Raw JSON recorded? |
|---|---|---|---|
| T01 | `INSTANT_AUTO_APPROVE` | `docs/evidence/a7/T01-grounded.png` | [x] |
| T02 | `INSTANT_AUTO_APPROVE` | `docs/evidence/a7/T02-grounded.png` | [x] |
| T03 | `INSTANT_AUTO_APPROVE` | `docs/evidence/a7/T03-grounded.png` | [x] |
| T04 | `INSTANT_AUTO_APPROVE` | `docs/evidence/a7/T04-grounded.png` | [x] |
| T05 | `MANUAL_INSPECTION_REQUIRED` | `docs/evidence/a7/T05-grounded.png` | [x] |
| T06 | `MANUAL_INSPECTION_REQUIRED` | `docs/evidence/a7/T06-grounded.png` | [x] |
| T09 | `FRAUD_RISK_FLAG` | `docs/evidence/a7/T09-grounded.png` | [x] |
| T10 | `MANUAL_INSPECTION_REQUIRED` | `docs/evidence/a7/T10-grounded.png` | [x] |

Do not change the expected decision based on the output. If the model disagrees with the preregistered expectation, record the actual output; the disagreement is the evaluation result.

## How to fill the recorded files

T02 is already recorded in `eval/recorded/baseline.json`. Edit that file for T03 and `eval/recorded/grounded.json` for all eight grounded cases. Replace the `null` fields with the actual response. Use this shape:

```json
"T03": {
  "source": "Playground",
  "captured_at": "2026-10-27T12:00:00.000Z",
  "raw": {
    "answers": {
      "refund_risk": {
        "type": "choice",
        "choice": "INSTANT_AUTO_APPROVE",
        "probabilities": {
          "INSTANT_AUTO_APPROVE": 0.0,
          "MANUAL_INSPECTION_REQUIRED": 0.0,
          "FRAUD_RISK_FLAG": 0.0
        },
        "confidence": 0.0
      },
      "fraud_signal": {
        "type": "noul",
        "noul": 0.0
      }
    }
  },
  "final_decision": null,
  "confidence_captured": true,
  "latency_ms": null,
  "notes": "Baseline Playground run; screenshot docs/evidence/a7/T03-baseline.png"
}
```

Rules:

- For new baseline runs and all grounded runs, set `final_decision` to `null`. The harness applies the existing validation and guardrails.
- If the Playground returns `q1`/`q2`, preserve the exact response in an extra `raw_playground` field and normalize `raw` to `answers.refund_risk` / `answers.fraud_signal`. This keeps the replay shape stable without losing the actual response.
- `confidence` is required for policy replay. If the Playground does not show it, write `null` and explain in `notes`; the harness will mark the case pending rather than guess.
- `latency_ms` is optional. Use the Playground duration if shown, or an approximate wall-clock time. It will be labelled as recorded wall-clock, not model-only latency. If absent, leave `null`.
- Set `confidence_captured` to `true` only when the confidence value is present.
- Keep `source` and `captured_at` factual.

## Run the harness

```bash
npm run eval:check       # validate the dataset and list pending recordings
npm run eval:baseline    # score baseline
npm run eval:grounded    # score grounded
```

Outputs:

- `logs/eval-baseline.json`
- `logs/eval-grounded.json`

A case with no actual response is reported as `PENDING`, not as a pass or fail. Accuracy is reported both as a percentage of completed cases and as a percentage of all 10 cases.

## Optional: live API with real latency

If you have a Jev/OpenRouter API key, the same harness can call the API and record real latency:

```bash
# PowerShell
$env:JEV_ENDPOINT="https://openrouter.ai/api/alpha/decisions"
$env:JEV_API_KEY="<server-side secret>"
npm run eval:baseline -- --live --runs 5 --record
npm run eval:grounded -- --live --runs 5 --record
```

This overwrites `eval/recorded/baseline.json` and `eval/recorded/grounded.json` with live responses, so back them up first. Never commit the key, paste it into the report, or put it in browser code.

## Evidence checklist

- [x] Baseline T02/T03 raw JSON recorded; screenshots still pending
- [x] Grounded T01-T06, T09-T10 raw JSON recorded; screenshots still pending
- [ ] No PII in screenshots or claim text
- [x] `npm run eval:baseline` and `npm run eval:grounded` run cleanly
- [x] `logs/eval-baseline.json` and `logs/eval-grounded.json` match the report tables
