# Original-500 exhaustive qualification preparation and ranking v8 — 2026-08-25

## Decision

Ranking v8 is **qualified on the exact frozen major-brands-300 capture**, but it
is **not honestly qualified across both cohorts**. Replaying v8 on the frozen
bytes changes zero icon/wide selections in either cohort. The major-brands v4
labels cover all 2,732 candidates, carry concrete safety classes, and produce a
complete 66.19 score through the selected-role adapter. The original 500 still
has only 586 selected-role judgments for 4,454 candidates, leaving 51 current
v8 selected-role slots without an exact judgment and no exhaustive candidate
coverage.

No missing judgments were inferred. A blinded, fingerprint-bound packet for all
4,454 original candidates is prepared and validated, but remains unadjudicated.
Cross-cohort promotion must remain false until that packet receives a complete
identity/role pass, an exhaustive negative-safety pass, and the resulting
canonical labels pass the qualification report.

## Reproduced gap and correction to the prior “44” statement

The 44 figure in the combined-800 report is reproducible, but it is not the
current ranking-v8 gap:

| Frozen original-500 selection surface | Selected slots | Missing exact role slots | Selected candidates with no label in any role |
| --- | ---: | ---: | ---: |
| Ranking v5 reference | 605 | 45 | **44** |
| Ranking v8 replay of the v7 byte set | 605 | **51** | **50** |

One candidate in each surface has a judgment for a different role, which is why
role-slot and entirely-unlabeled-candidate counts differ. Ranking v6 added eight
reviewed icon flips after v5; the retained v6/v7 run therefore cannot inherit
the v5 count. The machine report records both definitions and hashes the v5
reference so future reports do not collapse them into one number.

## Qualification results

| Requirement | Original 500 | Major brands 300 |
| --- | ---: | ---: |
| Assigned entities | 500 | 300 |
| Captured candidates | 4,454 | 2,732 |
| Canonical exhaustive labels | 0 | 2,732 |
| Fingerprint-bound labels | 0 | 2,732 |
| Concrete safety labels | 0 | 2,732 |
| Selected icon/wide slots | 605 | 366 |
| Selected slots labeled | 554 | 366 |
| Exact exhaustive snapshot qualified | **No** | **Yes** |
| Ranking v8 on frozen capture qualified | **No** | **Yes** |

The qualified major-brands replay produces the same 66.19/100 score, 170/227
correct icons, 116/227 correct wides, and three wrong-brand domains. Ranking v8
changes zero selections from the retained v7 result in both cohorts, but zero
movement is not a substitute for missing ground truth.

The machine-readable result is
`reports/cross-cohort-ranking-v8-qualification-2026-08-25/qualification.json`.
It includes every missing original selected slot, input and rerank SHA-256
values, the selected-role projection result, the historical-gap reconciliation,
and the prepared review-packet fingerprints.

## Prepared exhaustive review surface

The original-500 v8 replay packet contains 269 sheets covering the 398 companies
with captured candidates and all 4,454 candidate records. Candidate scores,
predicted roles, ranking reasons, and current selections are absent from the
review sheets. Each response must repeat the sheet fingerprint, which binds the
company/candidate mapping to the rendered PNG. The packet index also binds the
entire review surface to the SHA-256 of `results.jsonl`.

Packet status is `prepared_not_adjudicated`. The checked machine report records:

- packet index SHA-256 `9445dbc2b32b17470c4b413c6995b3a7b0ae03139ab75c57d2bef7466445753e`;
- candidate-ID-set SHA-256 `cef97993add56444e4a18496ea7459dc7e4028efe1979c9c2b3815b463951bb8`;
- response-template SHA-256 `a9c1fd245295e02e205ec5c907b1a42413ee9a39b6abbe920d0f25c6f990abc9`.

Completing only the 51 missing selected slots would make a selected-score claim
possible, but would not create parity with major-brands v4. The promotion gate
therefore requires all 4,454 canonical candidate labels plus concrete safety
classes for every negative.

## Exact snapshot versus current runtime

The qualification report distinguishes three scopes:

1. **Exact exhaustive snapshot:** every candidate in the hashed result is
   fingerprint-bound, safety-complete, and projectable to every selected role.
2. **Current ranking runtime on frozen capture:** the exact snapshot qualifies
   and its hash-bound rerank manifest names the repository's current ranking
   version. This is true only for major-brands-300.
3. **Current end-to-end runtime:** not qualified for either cohort. Frozen bytes
   do not recapture current extraction behavior, reachability, or website state.

Thus “ranking v8 qualifies on the major-brands frozen candidate set” is
supported. “Ranking v8 qualifies across both cohorts” and “the current runtime
scores 66.19/71.97” are not supported.

## Holdout integrity and limitations

- The tooling has no tuning profile and does not expose split labels. Ranking v8
  was replayed before label qualification, changed zero selections, and no
  implementation choice was made from evaluation outcomes.
- Development/evaluation labels were not opened to tune ranking behavior.
  Existing major-brands v4 labels were used only to confirm the frozen v8 replay
  after it was produced; original selected-only labels were used only to measure
  completeness.
- Frozen label and benchmark artifacts were read only. No company allowlist,
  label patch, or inferred adjudication was added.
- Visual adjudication remains the material unfinished work. The packet proves
  the work surface and its bytes; it does not prove candidate correctness.

## Reproduction

With the existing retained run root:

```sh
TASK_RUNS_ROOT=/Users/hendrik/Documents/logo-yoink/runs
QUALIFICATION_RUN="$TASK_RUNS_ROOT/2026-08-25-cross-cohort-ranking-v8-qualification"

node scripts/experiments/rerank-run.mjs \
  "$TASK_RUNS_ROOT/2026-08-25-frozen-500-embedded-logo-fix" \
  "$QUALIFICATION_RUN/original-500-v8"
node scripts/experiments/rerank-run.mjs \
  "$TASK_RUNS_ROOT/major-brands-embedded-logo-fix/all" \
  "$QUALIFICATION_RUN/major-brands-300-v8"

npm run visual-benchmark:label-sheets -- build \
  --run "$QUALIFICATION_RUN/original-500-v8"

npm run benchmark:qualify-ranking -- \
  --original-run "$QUALIFICATION_RUN/original-500-v8" \
  --original-reference-run "$TASK_RUNS_ROOT/2026-08-25-frozen-500-rank-v5" \
  --original-review-packet "$QUALIFICATION_RUN/original-500-v8/label-sheets-v3" \
  --original-labels labels/review-500-final-2026-08-22.jsonl \
  --original-assignments benchmarks/visual-benchmark-v1-500/entities.jsonl \
  --additional-run "$QUALIFICATION_RUN/major-brands-300-v8" \
  --additional-labels labels/major-brands-300-candidate-labels-v4-2026-08-25.jsonl \
  --additional-assignments benchmarks/major-brands-300-v1/entities.jsonl \
  --output reports/cross-cohort-ranking-v8-qualification-2026-08-25/qualification.json
```

After independent visual review, validate the packet responses, apply the
exhaustive negative-safety classifications, and rerun the same qualification
command with the new canonical label artifact. Do not modify or replace the
historical selected-only files.
