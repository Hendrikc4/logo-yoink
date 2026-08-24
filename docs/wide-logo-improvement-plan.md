# Wide logo improvement plan

Date: 2026-08-23

## Goal

Increase verified wide-logo coverage substantially while keeping wide identity/role precision near its current 96.7%. Focus on finding missing company wordmarks, not tuning ranking weights.

## Why discovery comes first

- The current system selects 235 correct wide logos across 385 current-company sites: 61.0% end-to-end recall.
- A correct wide candidate exists for 252 sites, and the ranker selects it correctly 93.3% of the time.
- Therefore most of the remaining gap is missing evidence, not ordering mistakes.
- Of 133 sites without a verified wide candidate, 99 already show a horizontal-lockup visual instance. Thirty-five show an unmapped one in the header/navigation.
- Visual capture already notices CSS masks and pseudo-elements, while browser discovery currently extracts only ordinary CSS backgrounds. This is the first gap to close.

## Simple experiment sequence

### 1. Recover real CSS assets

Extend the existing browser discovery pass to collect URLs from:

- computed `mask-image`;
- `::before` and `::after` background images;
- `::before` and `::after` mask images.

Limit this to visible header/navigation or home-linked elements. Feed recovered URLs through existing validation and ranking. Do not add a wide-specific score bonus.

### 2. Add a last-resort header crop

If a visible header wordmark has no asset URL and there is still no eligible wide result, capture the element as a PNG:

- at most one light and one dark version;
- no surrounding navigation or unrelated text;
- clearly tagged as a rendered fallback;
- ranked below portable SVG/image assets.

Track portable wide logos and background-dependent crops separately.

### 3. Compare the existing deep-wide fallback

On the same remaining misses, compare the existing deep-wide path. Keep whichever bounded approach finds more verified company wordmarks per request and byte. Do not build a new crawler.

## Test method

1. Use only development sites missing a verified wide candidate while implementing.
2. Blind-review every newly selected wide logo for identity, role, crop quality, and theme usability.
3. Make keep/drop decisions once on validation.
4. Do not repeatedly tune on the already-consumed evaluation split.
5. Report incremental requests, bytes, and latency only for sites where fallback runs.

## Keep criteria

Keep an experiment when it:

- adds a meaningful number of verified company wide logos;
- introduces no definite wrong-company selections;
- keeps overall wide identity/role precision close to 96.7%;
- does not reduce existing correct wide, icon, or favicon answers;
- has bounded cost on missing-wide sites.

The first milestone is to recover at least 20 additional verified wide logos. The target is directional, not a reason to accept weak crops or false positives.

## Explicit non-goals

- No broad rank-weight search.
- No relaxation that admits footer, partner, customer, or publication logos.
- No forced result for unreachable or ambiguous sites.
- No redesign of the crawler or benchmark.

After this pass, rerun the frozen benchmark replay and publish before/after wide coverage, precision, asset portability, and cost. Optimize ranking only if the new candidate set exposes a clear ranking failure.
