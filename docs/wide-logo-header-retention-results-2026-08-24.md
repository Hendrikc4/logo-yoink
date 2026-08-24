# Wide-logo header retention experiment

Date: 2026-08-24  
Baseline: `94161db88442fcfce2a9ecba72eb2325c8bc6eff`  
Decision: **keep**

## Outcome

The retained bundle adds three correct development selections—Utiq, MattoBoard, and Raywatt—with no wrong additions, wide losses, icon movement, or favicon movement. Blind review accuracy is 3/3 (100%). Applied to the frozen baseline, wide identity/role precision remains 238/246 (96.75%), above the 96% gate.

The one-shot five-site validation pair added no selected wides and caused no role movement. It still exercised the safety boundary: Carbix and Venice Music's `/null` observations resolved to foreign Wix inline SVG badges and remained ineligible; Simuland failed validation/download in both arms; DNA Chat timed out in both arms; beebizy was admitted and validated but was removed as a known URL before its stronger browser evidence could be merged. The keep decision is based on the three accurate development gains, zero development or validation regressions, and the general placement/shape rule. No validation tuning or evaluation live run followed.

## Retained changes

- Reject empty, literal null/undefined, `/null`, `about:blank`, and blob-only URLs before normalization while still checking `currentSrc`, `src`, `data-src`, `srcset`, picture sources, and inline SVG bytes.
- Give browser discovery and visual capture the same same-host localized-home rule.
- Include rendered width and height in browser priority.
- Within the existing eight-item browser budget, reserve no more than two slots for visible 1.8–12 aspect-ratio header/nav or home-linked assets.
- Let weak-text wide header/nav assets reach byte validation; the existing company agreement, generic-content, shape, and role gates still decide eligibility.
- Persist per-site retention stages in browser observation artifacts. Browser replay preserves icon and favicon selections because this fallback is wide-only.

No global budget increased, ranking weight changed, identity gate weakened, deeper crawl added, or body/footer relaxation was introduced.

## Exact 13-site diagnosis

| Split | Site | Baseline/live drop stage | Result |
| --- | --- | --- | --- |
| development | Raywatt | semantic filter | selected after wide nav placement/shape admission |
| development | MattoBoard | semantic filter | selected after weak-text wide header admission |
| development | Cited & Seen | frozen loss not reproduced; live control retained | already selected in the full-development parent |
| development | AdQuick | frozen loss not reproduced; live control retained | selected by both live arms |
| development | Fuse Oncology | invalid `/null`, then semantic/eligibility | tiny control remains rejected |
| validation | DNA Chat | browser timeout | no selection in either arm |
| validation | Simuland | validation/download | both assets failed byte validation in both arms |
| validation | beebizy | semantic filter, then known-URL dedupe | treatment validated it; no selection |
| validation | Carbix | invalid `/null`, then eligibility | foreign Wix badge remains rejected |
| validation | Venice Music | invalid `/null`, then eligibility | foreign Wix badge remains rejected |
| evaluation | Wortal | validation/download in prior observation | evaluation not consumed |
| evaluation | Moonwalk.com | invalid `/null`, foreign identity | evaluation not consumed |
| evaluation | PaylabsID | invalid `/null` with inline-SVG sibling | evaluation not consumed |

The machine-readable ledger contains the exact URLs and fuller explanations at `runs/wide-header-retention-2026-08-24/drop-stage-ledger.json`.

## Paired development results

The exact relevant development pair invoked Chromium for five sites per arm. The treatment produced three treatment-only selections in that forced five-site replay (Raywatt, MattoBoard, and Cited & Seen); Cited & Seen was already a correct selected wide in the full-development parent and is therefore not counted as a full-population addition.

The full current-company development parent contained 225 sites. Eighty-eight reachable wide misses entered both live browser queues.

| Metric | Control | Treatment | Delta |
| --- | ---: | ---: | ---: |
| Browser invocations | 88 | 88 | 0 |
| Selected wide results | 146 | 149 | +3 |
| Correct treatment-only selections | — | 3 | +3 |
| Wrong treatment-only selections | — | 0 | 0 |
| Selection churn | — | 3 | +3 |
| Icon changes | — | 0 | 0 |
| Favicon changes | — | 0 | 0 |
| Total requests | 5,539 | 5,602 | +63 |
| Total measured bytes | 190,201,771 | 189,302,407 | -899,364 |
| Browser latency p50 | 2,421 ms | 2,465 ms | +44 ms |
| Browser latency p95 | 4,933 ms | 5,043 ms | +110 ms |
| Browser-queue wall time | 126,721 ms | 131,319 ms | +4,598 ms |

The negative byte delta is page/CDN drift, not a claimed saving. The attributable cost signal is 28 additional candidate-validation requests and 1,026,906 additional validation bytes. All fallback traffic remains confined to sites missing a wide result.

## Blind review and gates

The treatment-only changed assets were reviewed without arm, source, or rank fields. Utiq, MattoBoard, and Raywatt are all the requested company's portable horizontal identity asset.

| Gate | Result |
| --- | ---: |
| New-selection accuracy | 100% (3/3), pass |
| Projected overall wide precision | 96.75% (238/246), pass |
| Existing correct wides lost | 0, pass |
| Icon regressions | 0, pass |
| Favicon regressions | 0, pass |

## One-shot validation

| Metric | Control | Treatment | Delta |
| --- | ---: | ---: | ---: |
| Browser invocations | 5 | 5 | 0 |
| Selected-wide churn | 0 | 0 | 0 |
| Icon/favicon changes | 0 | 0 | 0 |
| Total requests | 101 | 102 | +1 |
| Total measured bytes | 2,767,907 | 2,947,949 | +180,042 |
| Browser latency p50 | 2,768 ms | 2,749 ms | -19 ms |
| Browser latency p95 | 12,060 ms | 12,058 ms | -2 ms |

## Verification and artifacts

- Frozen baseline replay: `runs/wide-header-retention-2026-08-24/offline-baseline.json` and `offline-baseline-selections.jsonl`; exact baseline verification passed.
- Exact development pair: `dev-relevant-{control,treatment-v2}-observations/`, corresponding replay directories, and `dev-relevant-comparison.json`.
- Full-development regression: `dev-full-{control,treatment}-observations/`, corresponding replay directories, `dev-full-comparison.json`, and `dev-full-selection-churn.json`.
- Blind review: `blind-review.json`.
- Validation pair: `validation-{control,treatment}-observations/`, corresponding replay directories, and `validation-comparison.json`.
- Consolidated costs and gates: `metrics-summary.json`.
- Exact stage ledger: `drop-stage-ledger.json`.
- Full repository verification: 170 tests passed and 500 fixtures validated.

All experiment artifacts are ignored run data under `/Users/hendrik/.codex/worktrees/2e31/logo-yoink/runs/wide-header-retention-2026-08-24`. The frozen corpus remained read-only at `/Users/hendrik/Documents/logo-yoink/runs/visual-benchmark-v1-500-v1/merged`.
