# Wide-logo CSS recovery experiment

Date: 2026-08-24

## Decision

Drop the computed CSS mask and pseudo-element recovery implementation. It worked in focused Chromium controls, but it produced zero attributable wide selections on the frozen development miss set. The production code and its experiment-only tests were therefore removed before this commit. No rank weights, eligibility rules, icon answers, or favicon answers changed.

Do not add the rendered element-crop fallback from this experiment. The remaining visual observations are frequently containers, text, navigation, or SVG/image assets that were already rejected rather than isolated URL-free wordmarks. Safely converting them would require new byte-backed screenshot candidate plumbing and a reliable text/navigation exclusion step, which is not a clean extension of the tested URL recovery path.

## Frozen baseline replay

The frozen 500-entity replay reproduced the checked-in baseline exactly. Among 385 current-company sites:

| Wide metric | Frozen baseline | After retained changes |
| --- | ---: | ---: |
| Correct wide selections | 235 | 235 |
| Correct wide candidate available | 252 | 252 |
| End-to-end recall | 61.04% | 61.04% |
| Conditional rank recall | 93.25% | 93.25% |
| Identity precision | 97.53% | 97.53% |
| Identity/role precision | 96.71% | 96.71% |

The replay covered all development, validation, and evaluation records only to verify the already-frozen baseline. No evaluation labels were used to tune or decide the experiment.

## Development paired experiment

The experiment set contains the 67 development-split, current-identity sites without an adjudicated correct wide candidate. Fifty-nine reachable sites with no current wide selection entered both browser queues. Control used untouched commit `8b824e4`; treatment added computed `mask-image` plus `::before`/`::after` background and mask URL recovery, restricted to visible header/navigation/banner or home-linked elements. Recovered assets kept the existing `browser-css-background` source weight and passed through the existing identity gate, eight-candidate cap, download validation, content measurement, and ranker.

| Metric | Control | Treatment | Attributable change |
| --- | ---: | ---: | ---: |
| Browser invocations | 59 | 59 | 0 |
| Selected wide results in 67-site set | 3 | 3 | 0 |
| Raw browser candidates validated | 84 | 84 | 0 |
| New validated candidates added in replay | 31 | 33 | 0 from mask/pseudo recovery |
| Common existing-browser correct wide addition | 1 | 1 | 0 |
| Feature-attributable correct newly selected wides | 0 | 0 | 0 |
| Wrong-company/partner newly selected | 0 | 0 | 0 |
| Role-selection changes | 0 | 0 | 0 |
| Browser requests | 3,134 | 3,135 | +1 |
| Validation requests | 81 | 80 | -1 |
| Total requests | 3,215 | 3,215 | 0 |
| Browser declared bytes | 79,006,513 | 83,696,404 | +4,689,891 |
| Validation downloaded bytes | 3,709,502 | 3,697,229 | -12,273 |
| Total measured bytes | 82,716,015 | 87,393,633 | +4,677,618 |
| Browser latency p50 | 2,430 ms | 1,907 ms | -523 ms |
| Browser latency p95 | 5,427 ms | 3,906 ms | -1,521 ms |
| Browser-queue wall time | 79,838 ms | 70,648 ms | -9,190 ms |

The two extra treatment replay additions were an ordinary body image and a 17 px inline chevron observed during live-page drift; neither came from the tested CSS mechanism and neither was selected. The one selected wide added by both arms, OpenSphere, came from the existing browser path and had already been reviewed as correct. Live request, byte, and latency deltas include CDN/page drift and are not attributable feature cost. Because there were zero treatment-vs-control newly selected candidates, the feature-attributable blind selected-candidate review set was empty and overall wide role precision remained 235/243 (96.71%).

A direct raw-observation audit of the 15 frozen development header/navigation misses found one pseudo-element URL: Lendao's login-button icon. The unchanged identity gate correctly rejected it. Thirteen sites exposed no mask or pseudo-element asset URL in the bounded scope; AdQuick's live audit errored and produced no observation. This explains the zero downstream yield without weakening identity or eligibility checks.

Validation was not consumed after the development experiment produced zero correct additions. This follows the predeclared development-then-validation keep/drop discipline.

## Existing deep-wide comparison

The existing `deepWide` plus one-entry SPA path was run on the same residual treatment misses. It attempted and completed 58 reachable sites and produced zero new wide selections, with zero icon or favicon movement. Its same-day treatment-control delta was -3 requests, -223 bytes, and -37,550 ms; the negative live delta is page/network drift, not a claimed saving.

## Artifact paths

All generated artifacts are ignored run data under:

`runs/wide-css-recovery-2026-08-24`

- `offline-baseline.json` and `offline-baseline-selections.jsonl`: exact frozen replay.
- `dev-missing-control/sample.json` and `results.jsonl`: frozen 67-site development set.
- `control-observations/` and `treatment-observations/`: per-site browser observations and `warm-summary.json` cost summaries.
- `control-replay/` and `treatment-replay/`: paired reranked results and summaries.
- `browser-comparison.json`: zero role-selection changes across all 67 sites.
- `css-recovered-validated.json`: empty validated mask/pseudo recovery set.
- `raw-header-miss-audit.jsonl`: direct raw audit of the 15 frozen development header/navigation misses.
- `deep-wide-residual/summary.json`, `results.jsonl`, `assets/`, and `review.html`: residual existing-fallback comparison.

The external frozen corpus and adjudicated labels remain at:

`runs/visual-benchmark-v1-500-v1/merged`
