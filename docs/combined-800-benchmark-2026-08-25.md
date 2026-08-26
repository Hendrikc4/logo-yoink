# Combined 800-company benchmark — 2026-08-25

## Decision

The exact union of the qualified original-500 production-precision snapshot and
the qualified major-brands-300 ranking-v7 snapshot scores **70.67/100** across
800 assigned companies and 650 reachable companies. This is the cross-cohort
snapshot supported by the repository's present labels. It is not a
qualification of ranking v7 on the original 500: the preserved ranking-v7
500-company rows contain 51 icon/wide role slots without exact labels (50
selected candidates have no label in either role), so using them would make the
score incomplete. The previously stated 44 count belongs to the ranking-v5
reference and is reconciled in
`original-500-exhaustive-qualification-and-ranking-v8-2026-08-25.md`.

The combined number is computed from all raw result and label rows with the
existing scorer. It is not the weighted average of the two published headline
scores. In particular, p95 latency is recomputed from all 800 durations and
wrong-brand safety is recomputed over all 650 reachable domains.

The machine report records ranking v10 as the current runtime, but the 70.67
score remains an exact historical-snapshot result. It is not a score for v10.
The composed v10 replay changes four canonical original-500 selections whose
replacement candidates lack exhaustive labels, so current-runtime
qualification remains explicitly false.

## Combined result

| Metric | Combined 800 | Original 500 | Major brands 300 |
| --- | ---: | ---: | ---: |
| Assigned / reachable | 800 / 650 | 500 / 423 | 300 / 227 |
| Benchmark score | **70.67** | 71.97 | 66.19 |
| Icon candidate coverage | 538/650 (82.77%) | 343/423 (81.09%) | 195/227 (85.90%) |
| Icon top-1 correct | 513/650 (78.92%) | 343/423 (81.09%) | 170/227 (74.89%) |
| Wide candidate coverage | 370/650 (56.92%) | 233/423 (55.08%) | 137/227 (60.35%) |
| Wide top-1 correct | 349/650 (53.69%) | 233/423 (55.08%) | 116/227 (51.10%) |
| Strict selected precision | 862/952 (90.55%) | 576/586 (98.29%) | 286/366 (78.14%) |
| Wrong-brand domains | 3/650 (0.46%) | 0/423 | 3/227 (1.32%) |
| p95 duration | 7,069 ms | 4,502 ms | 30,003 ms |
| Mean requests / reachable domain | 14.7 | 13.9 | 16.4 |
| Mean bytes / reachable domain | 1.29 MB | 1.20 MB | 1.45 MB |

The score components are 20.95 coverage, 19.89 top-1 correctness, 11.89
visual usability, 9.54 safety, and 8.39 efficiency. On an all-assigned-domain
basis, correct top-1 coverage is 513/800 (64.13%) for icons and 349/800
(43.63%) for wides. Those end-to-end rates disclose the 150 capture failures
that the canonical quality-score denominator excludes.

## Cohort difference and optimization audit

The expansion is not simply harder to reach. Among reachable sites it captures
more labeled-correct candidates than the original cohort (+4.82 percentage
points icon coverage and +5.27 points wide coverage), yet selects fewer of them
correctly (-6.20 points icon top-1 and -3.98 points wide top-1). Strict selected
precision is 20.15 points lower. That pattern is evidence of cohort brittleness
in eligibility/ranking and brand-role discrimination, rather than a discovery
system that merely sees fewer assets.

It does **not** prove conventional split overfitting:

- major-brands ranking v6 improved development, validation, and the one-shot
  evaluation split, and the final scores rise from 64.51 to 68.99 to 70.05;
  there is no development-high/holdout-low signature in that cohort;
- on the original cohort's later 300/100/100 manifest projection, scores are
  73.15 development, 72.71 validation, and 67.08 evaluation. The 6.07-point
  development-to-evaluation gap is a generalization warning, but those split
  assignments were created after the historical original-cohort optimization
  and therefore are diagnostic, not a clean untouched experiment;
- optimization was operationally cohort-split: early ranking/discovery work
  used the original fixture, while ranking v6 was selected on the 300 expansion
  with only changed-slot regression review on the 500. The large cohort gap is
  consistent with that history, but it is also confounded by different company
  populations, capture dates, ranking snapshots, and label protocols.

The defensible conclusion is that prior work generalized within the 300
development/validation/evaluation split, while the overall system remains much
less precise on the curated major-brand population. Future promotion gates
should require simultaneous gains on both cohorts and a new untouched holdout,
not alternating optimization against either cohort's now-open evaluation
labels.

## Remaining concrete opportunities

1. **Recover missing wide assets.** The exhaustive 300 labels attribute 90 wide
   losses (and 32 icon losses) to no captured correct candidate. First-party
   rendered header marks, CSS backgrounds/masks, and bounded brand-asset paths
   remain the largest quality opportunity, provided new admissions keep the
   zero-new-wrong-brand gate.
2. **Fix the bounded ranking and eligibility misses.** The 300 taxonomy has 20
   icon and 6 wide ranking misses plus 5 icon and 15 wide eligibility misses.
   These are cheaper frozen-replay targets than new discovery and should be
   tested on development, confirmed on validation, then checked against the
   original cohort before any new holdout is opened.
3. **Add stronger first-party corporate-role evidence.** Samsung's app icon,
   Dropbox's Reclaim.ai mark, and GitLab's HackerOne carousel mark account for
   the three remaining wrong-brand domains. Organization metadata, home-link
   placement, and corporate-name/domain agreement are safer signals than
   company allowlists or a broad DOM-source penalty.
4. **Reduce capture failures and timeout tails.** The expansion has 73 capture
   failures and a 30,003 ms p95 versus 4,502 ms on the original snapshot.
   Classify blocked/interstitial and timeout failures before adding requests;
   retry only a bounded failure class and preserve request/byte caps.
5. **Bring the 500 ground truth to parity.** The original labels cover selected
   roles only, so its reported candidate coverage equals correct top-1 by
   construction. A fingerprint-bound exhaustive safety/role pass comparable to
   major-brands v4 is required before claiming a single current-runtime score or
   comparing discovery-vs-ranking loss rates symmetrically.

## Method and integrity limits

- The original snapshot is the exact run matched by
  `review-500-final-2026-08-22.jsonl`; the 300 snapshot is the exact ranking-v7
  run matched by exhaustive v4-derived selected-role scoring labels. Their
  SHA-256 values are recorded in the machine report.
- The result qualifies those two frozen snapshots only. Ranking v7 is not fully
  label-qualified on the original 500, and the historical ranking-v3 visual
  baseline remains separately frozen by
  `benchmarks/frozen-baseline-qualification.json`.
- Original labels are selected-only and major-brand labels are exhaustive.
  Combined top-1 and safety are complete, but combined candidate coverage is a
  conservative lower bound because hidden correct original-500 candidates are
  unlabeled.
- Evaluation labels had already been opened by the historical benchmark cycles.
  This report performs aggregation only and makes no ranking or extraction
  choice from any label outcome. Those evaluation splits should no longer be
  treated as fresh holdouts.
- Websites and reachability drift. Results compare frozen captures, not a
  synchronized live crawl, and the canonical score excludes capture failures
  from its quality denominator.

## Reproduction

The generator validates exact assignment membership, disjoint cohort IDs,
known label entities, complete selected-role/safety labels, and records SHA-256
for every input:

```sh
TASK_RUNS_ROOT=/Users/hendrik/Documents/logo-yoink/runs
npm run benchmark:combined -- \
  --original-run "$TASK_RUNS_ROOT/review-final-all-500/results.jsonl" \
  --original-labels labels/review-500-final-2026-08-22.jsonl \
  --original-assignments benchmarks/visual-benchmark-v1-500/entities.jsonl \
  --additional-run "$TASK_RUNS_ROOT/major-brands-embedded-logo-fix/all/results.jsonl" \
  --additional-labels "$TASK_RUNS_ROOT/major-brands-embedded-logo-fix/all/scoring.jsonl" \
  --additional-assignments benchmarks/major-brands-300-v1/entities.jsonl \
  --output reports/combined-800-benchmark-2026-08-25/combined-benchmark.json
```

The machine-readable result is
`reports/combined-800-benchmark-2026-08-25/combined-benchmark.json`. The command
is read-only except for its atomic output write and exposes no tuning profile.
