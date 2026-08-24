# Harker wide-logo discovery result

## Decision

Keep the generic browser-discovery change. Structural roots retain their bounded 80-root budget. Homepage links are independently filtered to rendered, viewport-intersecting roots and then capped at 80; computed backgrounds use independent structural (100) and visible-home-link (80) budgets. No rank, eligibility, or site-specific rule changed.

Harker had 5 structural roots and 99 homepage links, but only 5 viewport-visible homepage links. Its bare logo anchor was raw homepage-link index 91 under `nav.header-nav`; the included nav could not find its externally computed background because descendant scanning intentionally recognizes only inline-background or logo-token elements. The new visible-home-link path recovers `harker-logo.png`, validates it as 183x32/3,489 bytes, and selects it as wide at score 95.

## Results

| Measure | Before | After |
| --- | ---: | ---: |
| Harker browser candidates | 0 | 1 |
| Harker selected wide | none | correct 183x32 PNG |
| Harker discovery requests | 110 | 110 |
| Harker declared browser bytes | 1,896,710 | 1,896,721 |
| Harker discovery latency | 3,179 ms | 2,892 ms |
| 25-site live cohort with a wide-eligible candidate | 6/25 | 6/25 |
| 25-site live cohort selected wides | 5/25 | 5/25 |
| Cohort browser requests | 1,442 | 1,437 |
| Cohort validation requests | 22 | 21 |
| Cohort latency p50 / p95 | 2,406 / 6,738 ms | 1,866 / 6,924 ms |
| Frozen 500 correct wides | 235/385 | 235/385 |
| Frozen 500 wide precision | 235/243 (96.71%) | 235/243 (96.71%) |
| Frozen 500 quality subtotal | 55.4675/90 | 55.4675/90 |

The bounded live cohort contained 20 deterministic development and all 5 available validation browser-fallback wide misses. It had no selected-wide gains, losses, or flips. Its request, byte, and latency differences include ordinary live-page/CDN drift; DOM inspection itself adds no network request. Harker adds one candidate-validation request and 3,489 successful payload bytes when recovered.

The one-time frozen evaluation replay covered 73 current-identity entities: 34 correct wides among 35 selections (97.14% precision), 36 entities with a correct wide candidate, and a 50.5479/90 quality subtotal. Frozen candidates cannot measure the newly discovered Harker asset; the evaluation replay is a regression check only.

## Verification and artifacts

- `npm test`: 181 tests passed and all 500 fixtures validated.
- Focused browser and extraction tests: `node --test test/discover-browser.test.mjs test/extractor.test.mjs`.
- Frozen replay: `node scripts/visual-benchmark-replay.mjs --root /Users/hendrik/Documents/logo-yoink/runs/visual-benchmark-v1-500-v1/merged --labels /Users/hendrik/Documents/logo-yoink/runs/visual-benchmark-v1-500-v1/merged/label-sheets-v3/candidate-labels-500-v1-adjudicated.jsonl --splits evaluation`.
- Ignored experiment artifacts: `runs/harker-wide-logo-discovery-2026-08-24/`.
