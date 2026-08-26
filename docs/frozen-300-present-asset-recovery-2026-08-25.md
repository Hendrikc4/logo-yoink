# Frozen 300 present-asset recovery — 2026-08-25

## Decision

Promote the bounded ultrawide-wordmark eligibility rule, evaluated in isolation
as ranking v9 and released together with the corporate-identity gate as ranking
v10. A candidate
whose measured ratio is between `12:1` and `14:1` can qualify as wide only when
the existing strong first-party evidence is present: home linkage, header/nav
placement, or an authoritative metadata source. The change reuses frozen
candidates and adds no discovery, network, browser, or model work.

The exhaustive v4 labels were projected to the existing development-only label
file before diagnosis. Evaluation labels and evaluation replay outputs were not
opened or used. Frozen results, candidate assets, labels, assignments, and
published reports were not modified.

## Diagnosis and rejected hypotheses

The ranking-v6 development projection reproduces 13 ranking misses and 12
eligibility misses among 180 assigned entities. The diagnostic now records, for
each correct candidate, its stored role score, score reasons, explicit role
exclusion, threshold failure, stored predicted-role rejection, placement
evidence, and the selected-to-correct score delta. This makes the rejecting or
outranking signal inspectable without a live recrawl.

Two broader development hypotheses were rejected:

- An exact visible-company-name bonus gained two icon slots but was not retained
  after a validation correct-to-incorrect wide-role movement.
- Relaxing the lower wide ratio from `1.45` to `1.3` gained Cloudflare and PwC
  but regressed Arc'teryx on development. The lower-bound change was removed.

The retained upper-bound rule isolates a geometry cliff: Cloudflare's
home-linked, explicitly named `719x59` wordmark scored `78` for wide but was
ineligible solely because its `12.19:1` ratio exceeded the old `12:1` cap.

## Frozen replay results

| Gate | Before | After | Changed slots | Reviewed result |
| --- | ---: | ---: | ---: | --- |
| Development selected-correct slots | 162 | 163 | 1 | Cloudflare wide recovered |
| Development eligibility misses | 12 | 11 | 1 | zero regression; zero new wrong-brand |
| Validation selected-correct slots | 60 | 61 | 1 | Financial Times wide recovered |
| Validation eligibility misses | 4 | 3 | 1 | zero regression; zero new wrong-brand |
| Original frozen 500 | unchanged | unchanged | 0 | no icon, wide, or favicon movement |

The development and validation changes preserve correct-brand identity, wide
role semantics, and reviewed theme usability. Ranking misses are unchanged.
The one-line production change therefore recovers two eligibility losses across
the tuning and confirmation splits, not all 46 known present-asset losses.

## Reproduction

The source run is the immutable
`runs/2026-08-24-major-brands-300-stage-2` capture. Rerank development and
validation with `scripts/experiments/major-brands-v4-ranking-cycle.mjs`, using
their matching split files and the existing `labels-final-development.jsonl`
or `labels-final-validation.jsonl` projections under
`runs/major-brands-v4-cycle`. Analyze each output with
`scripts/experiments/analyze-major-brands-labels.mjs`.

For original-500 protection, rerank
`runs/review-final-all-500` with `scripts/experiments/rerank-run.mjs` before and
after the threshold change and compare every `selected_by_role` pointer. The
comparison produced zero changes across 500 entities and all three persisted
roles.

No evaluation command is part of this reproduction. The repository release
gate is `npm run check`.

## Limits

This is offline qualification of a narrow ranking/eligibility change against
captured bytes. It does not improve capture failures or absent correct assets,
does not claim a new all-300 score, and does not reopen the evaluation split.
The original-500 labels are selected-only, but zero changed pointers make that
ground-truth limitation immaterial for this delta review.
