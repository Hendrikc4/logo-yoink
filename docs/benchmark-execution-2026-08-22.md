# Logo discovery implementation and benchmark results

Date: 2026-08-22
Plan: [`docs/logo-discovery-plan.md`](logo-discovery-plan.md)
Configuration chosen for the 500-company run: static homepage discovery, no expanded pages, no synchronous browser fallback

## Outcome

The implementation now returns independently ranked `icon`, `wide`, and `favicon` candidates with provenance and interpretable score reasons. Across all 500 fixed companies it found:

| Cohort | Sites | Reachable | Square/icon | Full/wide | Favicon | Availability proxy |
|---|---:|---:|---:|---:|---:|---:|
| Development | 100 | 80 | 66 | 42 | 67 | 56.6 |
| Frozen holdout | 100 | 86 | 76 | 57 | 73 | 67.8 |
| Remaining operational set | 300 | 257 | 223 | 150 | 214 | 64.0 |
| **Total** | **500** | **423** | **365 (73.0%)** | **249 (49.8%)** | **354 (70.8%)** | **63.3** |

The total proxy is the same transparent formula used by each run: 40% icon coverage + 40% wide coverage + 20% favicon coverage, with all sites in the denominator. It measures availability, not correctness.

The development result improved over the freshly reproduced pre-change pipeline:

- square/high-resolution legacy proxy: 48/100 before; 66 role-selected square marks now;
- full/wide role: 0/100 before because the old system did not select a separate wordmark; 42/100 now;
- p95 per-domain duration: about 5.95 seconds before; 3.42 seconds in the final static run.

Live websites drift, so these are paired cohort-level waypoints rather than a claim that every domain returned identical content between runs.

## Labeled quality score

Every selected icon and wide candidate in the development cohort was inspected in ten review montages on both a light and dark background. The 108 role-specific judgments are reproducible from [`reviews/original-100-final.json`](../reviews/original-100-final.json); the generated candidate-ID labels and score live in the ignored run artifact.

**Benchmark score: 57.26/100**

| Component | Points | Maximum |
|---|---:|---:|
| Correct usable coverage | 17.81 | 30 |
| Top-1 identity correctness | 18.19 | 30 |
| Top-1 visual usability | 10.97 | 20 |
| Wrong-brand safety | 1.25 | 10 |
| Efficiency | 9.04 | 10 |

Selected-asset precision on the reviewed cohort:

- icon: 60/66 correct identity (90.9%); 58 had at least conditional visual usability;
- wide: 37/42 correct identity (88.1%); all 37 correct wides had at least conditional usability;
- seven reachable domains returned at least one wrong-brand top selection, mostly expired, hijacked, parked, or unrelated redirect destinations.

The overall score is intentionally much lower than selected-asset precision because every reachable company missing a role loses coverage, correctness, and usability points. Safety also falls linearly from 10 points at 0% wrong-brand domains to 0 points at 10%.

## Ablations

### Expanded brand/about pages

Following up to two linked secondary pages increased the stale tuned run from 67 to 68 icon domains and 39 to 40 wide domains. Visual review found that the apparent additions were a home UI glyph and an `about` photograph, not verified logo wins. It added roughly 10% more requests, 17% more bytes, and 14% p95 latency. Expanded pages therefore remain opt-in.

### Rendered browser

The browser ablation invoked Chromium for 49/100 sites and increased wide availability from the then-current 39 to 45. Six new wide selections were visually strong, including AttackIQ, TradeBridge, TrialNav, and Curiominds. Cost rose sharply: 4,185 requests versus 1,066, 156 MB versus 99 MB, and 7.70-second versus 5.22-second p95 duration. Browser discovery is retained as a bounded fallback and now applies the same UI-control rejection, but it is not the synchronous default. It is best used as asynchronous cache warming for a missing wide role.

These ablations predate the final local-semantic and UI-control tuning, so their absolute availability numbers should not be compared directly to the final 66/42 development result. Their cost and visually verified incremental behavior remain the relevant decisions.

## What was implemented

- parsed-document discovery for visible images, lazy sources, `srcset`, `picture`, metadata logos, safe inline SVGs, manifests, and favicon families;
- first valid `<base href>` handling and bounded same-site brand-page discovery;
- separate role scores for icon, wide, and favicon, with score reasons and confidence bands;
- local logo semantics, home-link/header evidence, company-name agreement, negative partner context, and navigation-control rejection;
- byte validation, robust SVG-root checks, WebP/AVIF metadata through Sharp, SVG viewBox sizing, URL and byte-hash deduplication;
- per-request redirect revalidation, public-DNS checks, response/body timeouts, byte limits, and parked-domain detection;
- optional bounded Playwright discovery with request, transfer, deadline, SSRF, and hydration controls;
- frozen cohorts, JSONL run artifacts, content-addressed assets, failure taxonomy, contact sheets, review montages, repeat comparison, and label-complete scoring;
- 30 automated tests plus validation of all 500 fixture records.

## Main remaining failure modes

1. Expired or hijacked domains can expose a coherent but unrelated brand. A production service needs redirect/identity quarantine rather than silently trusting the current site.
2. Some correct marks work on only one background. Theme-aware variants should be returned when both are exposed rather than expecting one asset to work everywhere.
3. Static discovery still misses some JavaScript-only wordmarks. The browser tier improves this, but should be cached/asynchronous to keep the main request inexpensive.
4. Public deployment should pin the DNS-validated address at connection time. The current resolver checks every URL and redirect but still has a DNS check-to-connect race.
5. The 500-company availability numbers are automated. Only the development 100 has complete human quality labels; the holdout is a frozen availability check, not a second quality score.

## Reproduction

```bash
npm test
npm run benchmark -- --cohort original-100 --output runs/final-static-100
npm run benchmark -- --cohort holdout-100 --output runs/final-holdout-100
npm run benchmark -- --cohort remaining-300 --output runs/final-remaining-300
npm run review-montage -- runs/final-static-100
npm run review-labels -- runs/final-static-100 reviews/original-100-final.json
npm run benchmark -- score \
  --run runs/final-static-100 \
  --labels runs/final-static-100/review-labels.jsonl
```

Run directories are intentionally ignored because they contain downloaded third-party assets and time-sensitive crawl results.
