# Major-brands-300 independent review and ranking v6 — 2026-08-25

## Decision

Keep the benchmark semantic fixes, the exhaustive v4 labels, strict montage
failure behavior, and ranking v6's narrow declared-icon preference. The runtime
rule is deterministic and changes ranking only: it makes no network or AI call,
adds no candidate, and never displaces a home-linked DOM logo.

Ranking v6 changes 14 of 368 selected slots on the frozen 300-company run. It
produces eight net additional correct selections, removes one wrong-brand
domain, and has zero correct-to-non-correct regressions. Two changed slots remain
non-correct, but both were already non-correct under v5: Warner Bros. Discovery
moves between related-brand assets and BYD moves from unjudgeable to a
same-brand role mismatch. Because this experiment only flips existing slots,
there are no new admissions; the applicable gate is zero reviewed regression
and zero new wrong-brand domains. Availability is unchanged.

The frozen-500 v5-to-v6 delta contains eight icon flips: five reviewed gains,
three neutral same-brand changes, zero regressions, and zero ambiguous results.
RemoteEngine specifically changes from an NVIDIA mark to the requested company
icon. This is a delta qualification of ranking v6, not a rewrite of the
historical ranking-v3 published baseline.

## Independent ground truth

The prior v3 candidate-only file was not adequate for tuning: an omitted tile
was treated as wrong identity and then as wrong-brand safety. Three independent
review batches therefore re-reviewed all 168 frozen sheets and all 2,732
candidates without rank information. A separate fingerprint-bound pass assigned
one of `wrong_brand`, `related_brand`, `not_logo`, or `unjudgeable` to every
negative. The importer rejects an incomplete partition.

The initial review contained 1,014 correct, 1,689 wrong, and 29 ambiguous
candidate judgments. Reviewers then cross-reviewed all 101 selected non-correct
slots. Twelve proposed corrections survived a third blind inspection; seven
were rejected. A further 22 blind before/after pair reviews produced 30
provenance-checked candidate adjudications. The final v4 artifact contains:

| Identity / safety | Candidates |
| --- | ---: |
| Correct / correct brand | 1,019 |
| Wrong / not a logo | 1,149 |
| Wrong / wrong brand | 261 |
| Wrong / related brand | 272 |
| Ambiguous / unjudgeable | 31 |
| **Total** | **2,732** |

The canonical file is
`labels/major-brands-300-candidate-labels-v4-2026-08-25.jsonl`, SHA-256
`c626fa829de7268911e949f359a74f71e6494c0c5b36cdacfbd271884c8bf4b2`.
Every candidate is covered exactly once; label IDs, target keys, and
entity/candidate keys are unique. The v3 artifact remains immutable historical
evidence.

## Benchmark contract fixes

The benchmark now separates role correctness from identity safety. The
selected-role adapter can mark a same-brand wide wordmark false for the icon
slot without turning it into a wrong brand. A selected negative with
`unclassified_negative` safety makes the score incomplete instead of silently
receiving a safety classification.

`apply-visual-label-safety.mjs` adds the exhaustive second review pass. It
requires the exact sheet fingerprint, rejects duplicate or missing assignments,
and writes atomically without overwriting by default. Prompt/review versions are
stored in label provenance.

The montage tool also now fails when a referenced candidate cannot be rendered.
This fixes a review-integrity bug discovered during frozen-500 protection: a
broken asset symlink previously produced visually blank panels while the command
still exited successfully.

## Ranking hypothesis

Unlinked DOM squares frequently win icon ranking because page-content images
inherit strong filename, placement, or company-name scores. When the same page
also declares a viable manifest, Apple-touch, mask, tile, or HTML icon, that
bounded first-party declaration is the safer icon choice. Ranking v6 therefore:

1. ranks icon candidates normally;
2. checks whether the winner is a `dom-img`, `dom-picture`, or `browser-img`
   without `home_linked` evidence;
3. if a declared icon candidate is already icon-eligible and has icon score at
   least 49, selects the best declared candidate;
4. preserves home-linked DOM marks and the existing rendered-inline-SVG twin
   rule.

The broad version that displaced home-linked DOM marks was rejected. Its blind
review found a Wendy's regression and a visibly blurrier Nikon replacement.
Body-only and unplaced-DOM veto profiles were also not promoted; they either had
zero validation yield or withheld valid marks. These are precision-limited
negative results, not retest candidates without new evidence.

## Frozen split results

All figures use the final v4 labels and explicit selected-role scoring. The
development and validation splits were evaluated before the frozen evaluation
split was opened once. No tuning followed evaluation.

| Split | v5 score | v6 score | Correct slots v5 → v6 | Wrong-brand domains v5 → v6 | Changed slots |
| --- | ---: | ---: | ---: | ---: | ---: |
| Development (180; 130 reachable) | 63.70 | 64.51 | 158 → 162 | 3 → 3 | 6 |
| Validation (60; 47 reachable) | 66.33 | 68.99 | 59 → 60 | 1 → 0 | 3 |
| Evaluation (60; 50 reachable) | 68.55 | 70.05 | 61 → 64 | 0 → 0 | 5 |
| All 300 (227 reachable) | 64.85 | 66.19 | 278 → 286 | 4 → 3 | 14 |

All-300 strict selected precision rises from 278/368 (75.54%) to 286/368
(77.72%). This is much lower than the production frozen-500 precision because
the new cohort deliberately contains many difficult content, subbrand, and
changed-identity pages. The score should not be presented as meeting the legacy
98% population target. It is now trustworthy enough to expose the remaining
work rather than hiding it behind defective labels.

Availability does not move: 195/227 labeled-correct icon candidates and 137/227
labeled-correct wide candidates remain captured. Ranking-v6 top-1 correctness is
170/227 icons and 116/227 wides. The label-grounded loss taxonomy is:

| Outcome | Icon | Wide | Total |
| --- | ---: | ---: | ---: |
| Selected correct | 170 | 116 | 286 |
| Ranking miss | 20 | 6 | 26 |
| Eligibility miss | 5 | 15 | 20 |
| No captured correct candidate | 32 | 90 | 122 |
| Capture failure | 73 | 73 | 146 |

The remaining selected wrong-brand domains are Samsung icon, Dropbox icon, and
GitLab wide. They were not patched with company allowlists or new string
heuristics. Samsung exposes a non-corporate declared app icon; Dropbox selects a
Reclaim.ai navigation product mark; GitLab selects a HackerOne carousel mark.
The calibrated AI veto work did not meet its frozen acceptance gate, so it is
not used to conceal these failures.

## Cost and reproducibility

This cycle reused frozen bytes: zero new network requests, zero downloaded
bytes, zero browser invocations, zero API model calls, and $0 API spend. Review
work ran in Codex subscription tasks, where per-judgment token, dollar, and
model-latency telemetry is unavailable. Recorded review volume is 4,574
judgments: 2,732 candidate identity/role judgments, 1,689 negative safety
classifications, 101 selected-slot cross-reviews, 44 changed-candidate pair
judgments, and eight frozen-500 pair judgments.

Compact evidence is checked in under
`reports/major-brands-300-independent-review-2026-08-25/`. The machine-readable
score summary is `final-score-summary.json`; the two adjudication files prove
their original label IDs and values before applying a correction. Raw PNGs,
assets, and replay outputs remain under gitignored `runs/`.

Recreate a complete score with:

```sh
node scripts/benchmark/selected-role-scoring-adapter.mjs \
  --run runs/major-brands-v4-cycle/rank-v6-all \
  --labels labels/major-brands-300-candidate-labels-v4-2026-08-25.jsonl \
  --output runs/major-brands-v4-cycle/rank-v6-all-scoring.jsonl
node scripts/benchmark/benchmark.mjs score \
  --run runs/major-brands-v4-cycle/rank-v6-all \
  --labels runs/major-brands-v4-cycle/rank-v6-all-scoring.jsonl
```

The final implementation passed focused benchmark, extraction, and visual-sheet
tests. The repository-wide `npm run check` is the release gate.
