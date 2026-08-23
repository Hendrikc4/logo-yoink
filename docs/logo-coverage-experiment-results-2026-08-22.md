# Logo coverage experiment results — 2026-08-22

The canonical running index of all attempted experiments and their decisions is [`experiment-log.md`](experiment-log.md).

Round-two follow-up ablations are documented in [`logo-coverage-experiment-results-round2-2026-08-22.md`](logo-coverage-experiment-results-round2-2026-08-22.md). They tested asynchronous browser warming, identity quarantine, theme variants, and multi-observation provenance; none was promoted into the product path.

Five isolated OpenCode workers using `openrouter/stealth/ox-alpha` evaluated the opportunity groups in [`logo-coverage-improvement-plan.md`](logo-coverage-improvement-plan.md). Each worker used the same repository snapshot and frozen cohorts. Promising changes were then reimplemented narrowly in the live tree, rerun as independent ablations, visually reviewed, and tested together on the untouched holdout.

Availability counts below are automated candidate-role counts, not claims of correct coverage. Changed selections were inspected separately; all ranges and comparisons remain sensitive to live-site drift.

## Decision summary

| Track | Development result | Cost/risk | Decision |
|---|---:|---|---|
| Role-aware fixed download budget with a strong-evidence gate | Icon +2, favicon +3; one apparent wide loss was a landscaping photograph, not a logo | Requests −38%, bytes −67% in the isolated run | **Keep and enable** |
| Wide-only visual content bounds | Wide +3: Tenvos, Nui, Lisa; zero icon/favicon flips | No requests or bytes added; bounded 96 px Sharp scan | **Keep and enable** |
| Existing browser fallback | Wide +6 in the development cohort | Requests approximately tripled; p95 latency roughly doubled | Keep existing optional fallback; do not make synchronous/default |
| Inline/external CSS, root Apple icon, browserconfig | No selected-role gains | About +2.2 requests/domain for the CSS treatment | Drop |
| Brand/press pages and sitemap hints | No gains in the tested treatment | +60 requests | Drop generic expansion |
| Browser pseudo-elements, masks, shadow DOM and frames | Mechanically testable but no cohort candidates | Browser complexity and cost | Defer until a labeled miss set proves demand |
| BIMI | One DNS record in 100; no validated candidate/win | DNS and certificate validation work | Drop from default path |
| Android/iOS app association metadata | Associations found, no new first-party logo wins | Store rights/identity ambiguity | Drop as an asset source |
| GitHub, Wikidata, npm, Simple Icons | No verified wins | Rate limits, identity ambiguity, per-asset rights | Drop |
| Common Crawl and search-index hints | Stale hints, no current-domain verified win | Expired-domain/wrong-owner risk | Drop |
| OCR | Correct company-name agreement on 17% of sampled assets, no wrong agreements, no coverage gain | CPU and added dependency/complexity | Drop |
| Perceptual hashing | Corroboration groups but no coverage gain; degenerate hashes on blank assets | Added ranking/data-model complexity | Defer |
| Press-kit prevalence and screenshot/canvas extraction | No press links in 25 missing-wide cases; screenshot/canvas controls were unreliable | High network/browser/vision cost | Drop |

## Retained mechanisms

### Strong-evidence, role-aware candidate budget

The total download ceiling remains 16. Candidates are provisionally divided into icon, wide, and favicon queues, while negative/banner candidates and weak body images are excluded from the queue and its fallback. A DOM image needs a logo token, a home link, or header/navigation placement; structured and conventional favicon sources retain their own authority.

The first version admitted a KopiRun app screenshot as an icon because its alt text contained the company name. Visual review caught the error. The final gate removed that regression and also removed false candidate coverage consisting of staff portraits, a SOC 2 badge, and a landscaping hero photograph.

The feature is exposed as `roleAwareBudget` and as the benchmark flag `--role-budget`. It is enabled in the HTTP app and CLI, while the benchmark flag stays explicit so controls remain reproducible.

### Wide-only content bounds

For candidates with credible wide-logo evidence whose canvas ratio is below 1.8, the extractor performs one bounded Sharp decode, downsized to at most 96×96 samples. It trims transparent or corner-colored background and records a content box only when the result has a usable minimum edge and a ratio from 1.8 through 12.

Only wide-role scoring consumes this content ratio. Icon and favicon scoring continue to use the canvas ratio, preventing padded wordmarks from becoming square-icon wins. Conventional favicon sources, weak body images, blank images, and sliver-like content are not promoted.

The feature is exposed as `contentBoundingWide` and as `--content-bounding-wide`, and is enabled in the HTTP app and CLI.

## Paired results

### Development cohort (`original-100`)

| Run | Icon | Wide | Favicon | Proxy |
|---|---:|---:|---:|---:|
| Same-day control | 66 | 42 | 67 | 56.6 |
| Retained bundle | 68 | 44 | 70 | 58.8 |

The net wide count is +2 because content bounds added three correct wordmarks while the evidence gate removed Sloane's landscaping photograph. The two icon gains were Faster and Bloktok. The three content-bound gains—Tenvos, Nui, and Lisa—were visually confirmed first-party wordmarks. KopiRun's first-party cat icon remained selected after the gate correction.

### Frozen holdout (`holdout-100`)

| Run | Icon | Wide | Favicon | Requests/domain | Bytes/domain | p95 latency |
|---|---:|---:|---:|---:|---:|---:|
| Same-day control | 75 | 57 | 72 | 14.0 | 1.35 MB | 6.80 s |
| Retained bundle | 77 | 59 | 77 | 10.3 | 0.56 MB | 3.16 s |
| Delta | +2 | +2 | +5 | −26% | −59% | −54% |

The comparison reported nine selection flips and no role-availability losses. The new wide selections, Trampay and CompositeEdge, were visually confirmed as company logos. The queue also replaced several obvious false icon selections—including a reproductive-health photograph, a product mockup, and a third-party tool icon—with first-party favicons/icons.

Latency is noisy across live network runs; request and byte reductions are the more causal efficiency measures.

### All 500

The retained bundle produced 379 icon, 255 wide, and 379 favicon domains (proxy 65.9) in the current all-500 run. The documented earlier baseline was 365/249/354 (proxy 63.3). This is an unpaired historical comparison affected by site reachability and content drift, so the observed +14/+6/+25 counts are supporting evidence, not an attributed causal estimate. The paired development and holdout results are the promotion evidence.

## Browser fallback decision

The existing browser fallback remains the largest raw wide-recall lever in development: 42→48 wide domains. It required 37 browser invocations and increased requests from roughly 1,074 to 3,351, bytes from about 104 MB to 159 MB, and p95 latency from about 3.6 s to 7.5 s. All six gains came from capabilities already present in the browser extractor; new pseudo-element/mask/shadow/frame code found no cohort candidates.

The practical next step, if more recall is needed, is an asynchronous missing-wide cache-warming queue using the existing browser implementation—not more synchronous browser surface area.

## Safety and stop conditions

- Do not weaken the DOM evidence gate to admit body images based only on company-name agreement; that reproduced the KopiRun screenshot failure.
- Do not use content-box ratio for icon or favicon roles.
- Stop or gate either retained mechanism if labeled development/holdout review finds a new wrong-brand winner, a partner/UI asset winner, or more than one correct usable role loss per 100.
- Treat off-domain redirects and expired/reassigned domains as unresolved identity work. A strict redirect quarantine was not enabled because legitimate canonical-domain moves and rebrands need registrable-domain-aware evidence and labels.
- Keep generic press/about/sitemap expansion, external registries, OCR, and vision hashing out until a labeled miss set demonstrates at least two net correct usable wins per 100 at acceptable precision.
- Repeat live controls before attributing small differences, and use explicit reviewer labels; availability alone is insufficient.

## Reproduction

```sh
npm test

node scripts/benchmark.mjs --cohort original-100 \
  --role-budget --content-bounding-wide \
  --output runs/orchestrated-winners-original100 --concurrency 8

node scripts/benchmark.mjs --cohort holdout-100 \
  --output runs/orchestrated-control-holdout100 --concurrency 8

node scripts/benchmark.mjs --cohort holdout-100 \
  --role-budget --content-bounding-wide \
  --output runs/orchestrated-winners-holdout100 --concurrency 8

node scripts/benchmark.mjs compare \
  --before runs/orchestrated-control-holdout100 \
  --after runs/orchestrated-winners-holdout100 \
  --output runs/orchestrated-holdout-comparison.json
```
