# A7 before / after comparison

Generated: 2026-10-27T07:45:52.862Z
Baseline run: 2026-10-27T07:42:12.230Z (config 143d6d4a591ef998, git 91f73d1)
Grounded run: 2026-10-27T07:45:22.418Z (config ca35e777246cd817, git 91f73d1)

| Metric | Before | After | Change |
|---|---|---|---|
| Accuracy | 7/10 completed (70%); 70% of 10 | 10/10 completed (100%); 100% of 10 | +30 percentage points |
| p95 Latency | 753 ms (n=8) | 1052 ms (n=8) | +299 ms (+39.7%) |
| Cost per Task | N/A | N/A | N/A |

## Per-case results

| ID | Before | After | Result |
|---|---|---|---|
| T01 | pass (INSTANT_AUTO_APPROVE) | pass (INSTANT_AUTO_APPROVE) | Unchanged |
| T02 | fail (MANUAL_INSPECTION_REQUIRED) | pass (INSTANT_AUTO_APPROVE) | Changed |
| T03 | fail (MANUAL_INSPECTION_REQUIRED) | pass (INSTANT_AUTO_APPROVE) | Changed |
| T04 | fail (MANUAL_INSPECTION_REQUIRED) | pass (INSTANT_AUTO_APPROVE) | Changed |
| T05 | pass (MANUAL_INSPECTION_REQUIRED) | pass (MANUAL_INSPECTION_REQUIRED) | Unchanged |
| T06 | pass (MANUAL_INSPECTION_REQUIRED) | pass (MANUAL_INSPECTION_REQUIRED) | Unchanged |
| T07 | pass (MANUAL_INSPECTION_REQUIRED) | pass (MANUAL_INSPECTION_REQUIRED) | Unchanged |
| T08 | pass (MANUAL_INSPECTION_REQUIRED) | pass (MANUAL_INSPECTION_REQUIRED) | Unchanged |
| T09 | pass (FRAUD_RISK_FLAG) | pass (FRAUD_RISK_FLAG) | Unchanged |
| T10 | pass (MANUAL_INSPECTION_REQUIRED) | pass (MANUAL_INSPECTION_REQUIRED) | Unchanged |

## Summary

- Improved: T02, T03, T04
- Worsened: none
- Other decision changes: none
- Pending: none

A pending case has no actual recorded model response yet and is not counted as a pass or fail.
