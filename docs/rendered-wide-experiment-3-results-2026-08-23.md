# Experiment 3: rendered-wide feasibility result

Date: 2026-08-23

Baseline: `94161db88442fcfce2a9ecba72eb2325c8bc6eff`

Frozen source: `/Users/hendrik/Documents/logo-yoink/runs/visual-benchmark-v1-500-v1/merged`

## Decision

Drop the deterministic rendered-crop filter after its single validation run. Keep the audit utility and frozen result artifacts because they expose useful signal and the failure mode clearly, but do not integrate rendered crops into production and do not count either result as portable wide.

Development produced one clean Tapin2 wordmark from one proposal (100% new-selection accuracy), which satisfied the predeclared 90% gate for one validation run. Validation produced one proposal, a complete LEON Casino logo on the Haryon site, which is a wrong-company false positive (0% new-selection accuracy). Combined incremental `rendered_wide` precision is therefore 1/2 (50%). No tuning was performed after validation.

## Bounded method

The script considers only current-company entities in the requested split with no baseline portable-wide selection. It then requires a URL-free, unmapped, visible horizontal-lockup observation in header/navigation, an available crop, the specified box and ratio limits, and at least one of localized home-link, positive logo token, or normalized company-name agreement in retained DOM locator fields.

Repeated scroll observations are collapsed by company, theme, viewport, locator, and rendered box. Identical nested observations are collapsed by crop hash and box. The smallest qualifying descendant is evaluated per viewport. A median-border foreground model trims uniform padding and deterministically rejects empty/background-only crops, edge-clipped crops, and crops whose trimmed ratio leaves 1.8–12. No OCR, vision service, live crawl, production rank change, or evaluation-split pass was used. Output remains `rendered_wide`, background-dependent, and capped at one result per company/theme.

## Results

| Metric | Development | Validation | Combined tested splits |
| --- | ---: | ---: | ---: |
| Current companies | 225 | 87 | 312 |
| Missing baseline portable wide | 71 | 33 | 104 |
| URL-free unmapped header/nav observations | 109 across 11 companies | 76 across 8 companies | 185 across 19 companies |
| Gate-accepted observations | 18 | 29 | 47 |
| Deduplicated occurrences | 10 | 14 | 24 |
| Smallest-per-viewport crops checked | 7 | 13 | 20 |
| Proposed `rendered_wide` results | 1 | 1 | 2 |
| True company wordmarks | 1 | 0 | 1 |
| Incremental tier precision | 100.0% | 0.0% | 50.0% |

Portable metrics are unchanged. If the separate rendered tier were added only to the two tested splits, the bookkeeping would be:

| Metric | Baseline portable wide | Portable + separate rendered tier | Delta |
| --- | ---: | ---: | ---: |
| Development recall | 149/225 (66.22%) | 150/225 (66.67%) | +0.44 pp |
| Development precision | 149/154 (96.75%) | 150/155 (96.77%) | +0.02 pp |
| Validation recall | 52/87 (59.77%) | 52/87 (59.77%) | 0.00 pp |
| Validation precision | 52/54 (96.30%) | 52/55 (94.55%) | -1.75 pp |
| Combined tested-split recall | 201/312 (64.42%) | 202/312 (64.74%) | +0.32 pp |
| Combined tested-split precision | 201/208 (96.63%) | 202/210 (96.19%) | -0.44 pp |

These combined numbers are not a full-benchmark result because the already-consumed evaluation split was not run. Against the full frozen denominator, portable wide remains 235/385 recall (61.0%) and 235/243 identity/role precision (96.7%).

## Blind review ledger

| Split | Company | True company wordmark | False positive | Partial/clipped | Extra UI/text | Theme dependence |
| --- | --- | --- | --- | --- | --- | --- |
| Development | Tapin2 | yes | no | no | no | Light-only observation; dark behavior unverified |
| Validation | Haryon (ex Knock Knock) | no | yes — LEON Casino | no | no | Light-only observation; dark behavior unverified |

The development prefilter also demonstrated the intended deterministic rejections: a Rally photo strip was full-bleed/edge-clipped, Lendao was empty or clipped, Trustiu contained clipped unrelated GoDaddy text, and Fuse Oncology was background-only. These were rejected before becoming proposed results and are retained in the audit ledger.

## Exact artifacts

- Reusable audit/filter: `scripts/rendered-wide-audit.mjs`
- Tests: `test/rendered-wide-audit.test.mjs`
- Development: `reports/rendered-wide-experiment-3/development/{summary.json,audit.jsonl,proposals.jsonl,blind-review.jsonl,crops/}`
- Validation: `reports/rendered-wide-experiment-3/validation/{summary.json,audit.jsonl,proposals.jsonl,blind-review.jsonl,crops/}`

Frozen input SHA-256 values:

- `entities.jsonl`: `2f58d0f3d0ffadf8ac0dbeefaf0c0c94d5dceb31df3c8410c439893f1e1dc109`
- `captures.jsonl`: `d283a527bf1afef7cac9eae208572717de8926cdd626cb3dc3a843baefc6a16a`
- `visual-instances.jsonl`: `541d6daf03b640a365fd844b23cd8e4c5115934d849dbf057e8769ae7230e547`
- `mappings.jsonl`: `34c4df2b8911359ba3977da9add4e0ce2b9cda7e041ba131ee66ff78bf864232`
- `baseline-current-system-selections.jsonl`: `fd1fbc326c7077453d79d9c6107f9e1e40d60cd2e247ea027df2f2fc8fa31c5d`

Rendered output SHA-256 values:

- Tapin2 light: `7c7fce428cb378c2333ff6453b7944f390f73fe3f6c1fec4ae4d0593171bcf2b`
- Haryon/LEON Casino light: `2e8ebc8ebc32d344f619b850701dec134872d079502ac50c0381969deba1aa41`
