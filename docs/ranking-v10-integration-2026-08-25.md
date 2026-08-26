# Ranking v10 integration — 2026-08-25

## Decision

Release the independently validated corporate-identity gate and bounded
ultrawide-wordmark eligibility rule together as ranking v10. The two changes
compose without a development or validation regression. The evaluation split
was not opened, scored, or used for this integration decision.

The release is deliberately not marked current-runtime-qualified. Relative to
the frozen original-500 ranking-v8 replay, v10 changes four canonical slots:
Gameye wide, Fastyr icon, Untamed Planet wide, and Rateweb.co.za icon. The old
selections have selected-only labels, while the v10 replacements do not have
the fingerprint-bound exhaustive labels required to judge the delta. No label
was inferred or invented.

## Composed replay

The current ranker was replayed offline over the existing
`major-brands-embedded-logo-fix` development and validation captures. Candidate
labels came from the already-open exhaustive v4 development and validation
files. Evaluation artifacts were not read.

| Split | Baseline | Ranking v10 | Correct icon | Correct wide | Wrong-brand domains |
| --- | ---: | ---: | ---: | ---: | ---: |
| Development | 64.51 | **67.24** | 97→98 | 65→66 | 3→0 |
| Validation | 68.99 | **69.52** | 37→37 | 23→24 | 0→0 |

The corporate-identity changes remove the Samsung and GitLab wrong-brand
answers and replace Dropbox's product mark with the corporate mark. The wider
geometry bound recovers Cloudflare on development and Financial Times on
validation. There are no newly labeled wrong-brand selections in either split.

## Qualification boundary

The published combined-800 score of 70.67 remains valid only for its exact
hashed historical input snapshots. Regenerating its machine report records
ranking v10 as the current runtime without rewriting the frozen selections or
claiming that the score measures v10.

`benchmarks/frozen-baseline-qualification.json` therefore acknowledges runtime
v10 while retaining `qualifies_current_runtime: false`. Completing the 269-sheet,
4,454-candidate original-500 exhaustive review packet is the concrete path to a
valid current-runtime cross-cohort score.

## Reproduction

```sh
node scripts/experiments/rerank-run.mjs \
  runs/major-brands-embedded-logo-fix/development \
  runs/ranking-v10-integration/development
cp runs/major-brands-embedded-logo-fix/development/summary.json \
  runs/ranking-v10-integration/development/summary.json
node scripts/benchmark/selected-role-scoring-adapter.mjs \
  --run runs/ranking-v10-integration/development \
  --labels runs/major-brands-v4-cycle/labels-final-development.jsonl \
  --output runs/ranking-v10-integration/development/scoring.jsonl
node scripts/benchmark/benchmark.mjs score \
  --run runs/ranking-v10-integration/development \
  --labels runs/ranking-v10-integration/development/scoring.jsonl \
  --output runs/ranking-v10-integration/development/score.json
```

Repeat with `validation` and `labels-final-validation.jsonl`. For the
original-500 delta, rerank `runs/2026-08-25-frozen-500-embedded-logo-fix` and
compare only canonical `icon` and `wide` pointers with
`runs/2026-08-25-cross-cohort-ranking-v8-qualification/original-500-v8`.

Repository release validation is `npm run check`.
