# Luna identity-verifier context retest: v2–v4

Date: 2026-08-25
Decision: **FINAL STOP / overall verifier no-go**

This report checks in the completed identity-verifier development retests as
negative results. The governing directive was
[Next phase: break the identity-precision bottleneck with an async AI verifier](next-phase-ai-verifier-prompt-2026-08-24.md).
The preceding implementation and feasibility records are
[WS1](identity-verifier-ws1-2026-08-24.md) and the
[v1 Luna gate](luna-identity-verifier-gate-2026-08-24.md).

## Scope and integrity

The three prompt hypotheses were run as separate cache-invalidating
development experiments on the same 38-case development set. The copied
prompts are [v2](../prompts/identity-veto-v2.md),
[v3](../prompts/identity-veto-v3.md), and
[v4](../prompts/identity-veto-v4.md); each is byte-for-byte identical to its
run prompt artifact.

The context freeze covered 58 domains, with 58 successes and 95 requests,
transferring 22,392,513 bytes. Request latency was p50/p95 416/1,520 ms. All
38/38 development cases and 120/120 fresh-holdout cases had contextualized
rows. No raw HTML was stored and no labels were changed.

The 120-case fresh holdout (60 wrong, 60 correct) was prepared and
contextualized, but never reviewed. Its sealed labels and panels remain
untouched and valid for a future materially different model or method. No
fresh-holdout labels, panels, or judgments were inspected here; no judgments
were changed; no calibration was run beyond these completed development
experiments; and Workstream 2 was not started.

## Development results

| Prompt | Result | Interpretation |
|---|---|---|
| v2 | 9 accept / 22 reject / 7 ambiguous; zero wrong accepts; 100% accept precision | **STOP.** Willow→Because was rejected 1/1 and Digitoys was rejected 2/2. Bhr's stale correct-asset rejection is not a required current-identity accept; all Bhr wrong candidates were withheld. Recall/policy-limited under the safety constraint. |
| v3 | 10 accept / 15 reject / 13 ambiguous; one Bhr→RealReports wrong accept; 9/10 = 90% accept precision | **STOP.** Digitoys was accepted 2/2 and Willow was rejected. Precision-limited. |
| v4 | 3 accept / 22 reject / 13 ambiguous; zero wrong accepts; 100% accept precision | **FINAL STOP.** Because was rejected 1/1 and Digitoys was rejected 2/2 systematically. Recall/policy-limited under the safety constraint. No further prompt tuning is permitted on this development set. |

The detailed frozen scores are [v2](../runs/identity-verifier-luna-calibration-2026-08-24/v2-scoring/development-score.md),
[v3](../runs/identity-verifier-luna-calibration-2026-08-24/v3-scoring/development-score.md),
and [v4](../runs/identity-verifier-luna-calibration-2026-08-24/v4-scoring/development-score.md).

V2/v4 trade away required current-identity recall for safety, so they are
recall/policy-limited rather than safe shipping configurations. V3 restores
the Digitoys rename controls but admits a wrong Bhr candidate, so it is
precision-limited. The overall verifier is **no-go**. Workstream 2 remains
forbidden.

## Reviewer and cost accounting

The configured reviewer model was `gpt-5.6-luna` through the Codex
subscription. Subscription tokens and dollars were unavailable. Approximate
reviewer task wall times from orchestration were v2 203.3 seconds, v3 242.5
seconds, and v4 222.7 seconds: 668.5 aggregate task-seconds across 114
judgments, or 5.86 task-seconds per judgment. These are orchestration task
times, explicitly not model latency.

There were no synchronous/product path changes and no benchmark score change.

## Final disposition

The v2–v4 development experiments are negative results. Do not dispatch or
inspect the fresh holdout, do not change frozen labels or run artifacts, do
not perform more calibration on this development set, and do not start
Workstream 2. The untouched fresh holdout is retained for a future materially
different model or method.
