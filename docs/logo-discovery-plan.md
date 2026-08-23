# Logo Yoink: logo discovery and evaluation plan

Status: implemented and benchmarked; see [`benchmark-execution-2026-08-22.md`](benchmark-execution-2026-08-22.md)  
Date: 2026-08-22  
Scope: improve logo gathering and ranking; do not build the public Logo.dev-compatible API yet

## 1. Goal

Build a free, open-source pipeline that takes a company domain and returns the best publicly exposed brand assets with provenance:

- `icon`: compact symbol suitable for avatars and square tiles;
- `wide`: a horizontal wordmark or symbol-plus-wordmark lockup;
- `favicon`: browser icon, retained as its own role instead of being mistaken for every kind of logo.

Theme (`light`, `dark`, `monochrome`, `unknown`) is an attribute, not a separate role. Social banners are an exclusion/diagnostic label in this cycle, not a ranked output. A finer wordmark-versus-lockup label can be retained when obvious, but it will not drive first-cycle scoring or gates.

For the first implementation cycle, success means improving correct, usable asset retrieval on the repository's fixed 100-company development cohort, confirming the frozen result on a labeled 100-company holdout drawn from the other 400, and then checking operational behavior on the remaining 300. It does **not** mean matching Logo.dev's claimed global coverage, CDN, search index, or manually curated database.

## 2. Product and engineering decisions

1. **Return a small asset set, not one universal winner.** A square icon and a wide wordmark solve different UI needs. Rank candidates within each role.
2. **Static extraction remains the default.** It is cheaper, faster, and easier to operate. Use a browser only when static extraction has low confidence, the page is clearly JavaScript-rendered, or access differs in a real browser.
3. **Prefer evidence over source prestige alone.** DOM placement, semantic labels, company-name agreement, file traits, and repeated use should contribute independent score components.
4. **Keep scoring interpretable.** Start with hand-tuned features and record each contribution. Do not add an LLM, OCR service, or trained vision model until labeled failures show that simpler evidence has plateaued.
5. **Preserve originals.** Store the fetched bytes and metadata. Derivative PNG/WebP sizes, padding, greyscale, and theme transformations are a later serving concern, not discovery.
6. **Never present a generated letter tile as a discovered logo.** It may be an API fallback later, with explicit provenance.
7. **Treat Logo.dev's internals as unknown.** Its public documentation shows outputs and API behavior, not its crawler or ranking implementation. We can reproduce useful behavior, but should not claim to know its private method.

## 3. Current repository baseline

The current implementation in `src/extractor.mjs` already has a good small core:

- zero runtime dependencies;
- Schema.org `Organization`/`Brand` family logo extraction from JSON-LD;
- manifest, Apple touch icon, HTML icon, `/favicon.ico`, and `/favicon.png` discovery;
- optional self-hosted Besticon integration;
- byte limits, timeouts, format sniffing, image-dimension checks, concurrent validation, and source provenance;
- a fixed 500-company fixture and an initial 100-company benchmark.

The existing benchmark reports 70/100 valid images and 48/100 square/high-quality images for the custom structured-data/manifest pipeline. The union of every previously tried method reached 75/100 valid and 53/100 square/high-quality, with visual inspection showing only about three unambiguous quality wins. These numbers are a historical waypoint, **not a reproducible baseline**: the original per-domain artifacts/comparator harness were not committed and live sites have drifted. Phase 0 establishes a fresh baseline on the same 100 domains; later work compares against that run.

The largest current limitations are:

- only metadata and favicon-like sources are parsed; visible header/nav logos are ignored;
- all roles share one score, whose large square-image bonus can bury a correct wordmark;
- candidate equality is URL-only, so identical assets at different URLs remain duplicates;
- SVG, WebP, and AVIF inspection is shallow, and there is no transparency/padding/blank-image analysis;
- regex-based HTML parsing will miss or misread enough real-world markup to limit the next phase;
- the initial hostname check is not production-grade SSRF protection because redirects, DNS resolution, and every discovered asset URL also need enforcement;
- `MAX_HTML_BYTES` rejects an oversized homepage instead of retaining its useful prefix, even though the head/header is normally early in the response;
- the attempt list does not try the `www` host when a bare fixture domain's apex is misconfigured;
- company names are not passed to `extractLogos`, and legal entity names in the fixture often differ from the operating brand;
- returning a base64 data URL for every candidate is expensive for batch evaluation;
- there is no saved run artifact, labeled ground truth, contact sheet, per-domain flip table, or failure taxonomy for repeatable iteration.

## 4. Research findings to use

### What Logo.dev publicly demonstrates

Logo.dev's documentation distinguishes favicon, company logo, wordmark/brandmark, monogram, and social banner. Its Brand API returns a square logo, a wide brandmark, social banners, colors, and a freshness timestamp; its image API serves resized PNG/JPG/WebP (and limited SVG), light/dark theme handling, greyscale, retina output, and a monogram-or-404 fallback. This supports our role-separated data model and a later transformation/CDN layer, but does not reveal how Logo.dev discovers or selects originals.

Sources (vendor documentation retrieved 2026-08-22; behavior and terminology may change):

- [Logo.dev concepts and documentation index](https://www.logo.dev/docs/llms.txt)
- [Logo.dev domain image parameters](https://www.logo.dev/docs/logo-images/get)
- [Logo.dev Brand API response](https://www.logo.dev/products/brand-api)
- [Logo.dev Describe/Brand distinction](https://www.logo.dev/docs/describe/introduction)

### Open-source implementations worth borrowing from

| Project | Useful idea | License / caution | Plan |
|---|---|---|---|
| [mat/besticon](https://github.com/mat/besticon) | Mature favicon enumeration, `<base>` handling, deterministic selection, caching, bounded responses/timeouts, redirect limits, and recorded-site fixtures | MIT; favicon-focused | Keep as an optional baseline/fallback. Port only specific rules that beat our native extractor; independently harden DNS/connection SSRF controls. |
| [metascraper-logo](https://github.com/microlinkhq/metascraper/tree/master/packages/metascraper-logo) | `og:logo`, microdata `itemprop=logo`, and broader JSON-LD logo paths | MIT; intentionally narrow and square-biased | Add the missing selectors natively and retain provenance. |
| [branding-go](https://github.com/julianmarshall911/branding-go) | Logo-like anchor/image attributes, header-first image, lazy-loaded URLs, tiny-image filtering | Apache-2.0; small/young project | Reimplement the simple heuristics in JavaScript; copy code only if the Apache notice and modification requirements are handled. |
| [robtaylor/logo-downloader](https://github.com/robtaylor/logo-downloader) | Header/nav images and inline SVG, CSS backgrounds, press/brand/media pages, downloadable assets, byte-hash dedupe | MIT; some first-match and blind-path heuristics are noisy | Reuse the bounded linked press-page and asset-enumeration ideas; require attribution for copied code. |
| [1e0h/logo-extractor](https://github.com/1e0h/logo-extractor) | `srcset`, inline header SVG, OG/Twitter fallback, common-path probes | No license file found during review; very new and unproven | Use only as a hypothesis/test list. Do not copy its code unless the licensing situation changes. |
| [dembrandt/dembrandt](https://github.com/dembrandt/dembrandt) | Playwright-rendered DOM and computed-style inspection for JavaScript-heavy sites | MIT; browser startup and stabilization cost | Reference for a conditional browser adapter, not the default path. |
| [R0GGER/favicon-api](https://github.com/R0GGER/favicon-api) | Provider racing, head-start for preferred source, bounded batches, TTL/LRU discovery cache | No license file found during review; favicon-focused | Independently implement only proven scheduling/cache concepts. Do not copy code or make third-party favicon services part of the reproducible core benchmark. |
| [Simple Icons](https://github.com/simple-icons/simple-icons) | Curated SVG symbol fallback and brand color metadata | CC0 for project assets, but trademarks and per-brand guidelines still apply | Future popular-brand fallback only; never score it as website-discovered. |

Any direct code reuse must be isolated in a small commit with the upstream URL, exact revision, license check, attribution/notice, and tests. Ideas and algorithms can be reimplemented cleanly. Do not copy AGPL code into this MIT repository without deliberately changing the project's licensing strategy.

Concrete source files to inspect when implementing (no code has been copied yet):

- Besticon: [`extract.go`](https://github.com/mat/besticon/blob/main/besticon/extract.go), [`sorting.go`](https://github.com/mat/besticon/blob/main/besticon/sorting.go), [`http.go`](https://github.com/mat/besticon/blob/main/besticon/http.go), and its [recorded test fixtures](https://github.com/mat/besticon/tree/main/besticon/testdata);
- metascraper-logo: its small [selector implementation](https://raw.githubusercontent.com/microlinkhq/metascraper/master/packages/metascraper-logo/src/index.js);
- branding-go: [`logo.go`](https://github.com/julianmarshall911/branding-go/blob/main/logo.go) and [`branding.go`](https://github.com/julianmarshall911/branding-go/blob/main/branding.go);
- logo-downloader: [`logo_downloader.py`](https://github.com/robtaylor/logo-downloader/blob/main/logo_downloader.py), especially linked press-page discovery and byte-hash dedupe;
- Simple Icons, if the future cohort justifies it: [metadata](https://github.com/simple-icons/simple-icons/blob/develop/data/simple-icons.json), [source-quality rules](https://github.com/simple-icons/simple-icons/blob/develop/CONTRIBUTING.md), and [legal disclaimer](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md).

### Standards-backed sources

- [Schema.org's `logo` property](https://schema.org/logo) is direct structured evidence.
- [The W3C Web App Manifest specification](https://www.w3.org/TR/appmanifest/) defines icon sizes and `purpose` values such as `any`, `maskable`, and `monochrome`; retain these rather than flattening all manifest icons together.
- [The BIMI Group implementation guide](https://bimigroup.org/implementation-guide/) defines a DNS record that can point to an organization's SVG logo. BIMI is a high-value, domain-controlled square-logo source, though coverage will be limited and a self-asserted record is not equivalent to a verified trademark certificate.
- [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html) standardizes robots.txt processing and should inform the page-crawling policy.
- Logo-detection research such as [WebLogo-2M](https://openaccess.thecvf.com/content_ICCV_2017_workshops/papers/w5/Su_WebLogo-2M_Scalable_Logo_ICCV_2017_paper.pdf) is aimed mainly at recognizing logos inside unconstrained images. That is a later option for screenshots/social banners, not the efficient first solution for visible DOM assets.

## 5. Target data model

Use one normalized candidate record throughout discovery, validation, classification, and ranking:

```json
{
  "url": "https://example.com/assets/logo-dark.svg",
  "resolved_url": "https://cdn.example.com/logo-dark.svg",
  "source": "dom-img",
  "source_page": "https://example.com/",
  "evidence": {
    "element": "img",
    "dom_region": "header",
    "home_linked": true,
    "alt": "Example",
    "class_tokens": ["site-logo"],
    "discovery_order": 3
  },
  "declared": { "width": 220, "height": 48, "theme": "dark" },
  "observed": {
    "format": "svg",
    "width": 220,
    "height": 48,
    "has_alpha": true,
    "byte_hash": "...",
    "blank": false
  },
  "role_scores": { "icon": 0.08, "wide": 0.91, "favicon": 0.02 },
  "confidence_band": "high",
  "score_reasons": ["header +18", "logo token +15", "company name +12"],
  "provenance": { "retrieved_at": "...", "http_status": 200 }
}
```

Keep data URLs out of benchmark JSON. Save assets by content hash and refer to their local artifact paths; this makes run outputs small and deduplicates bytes naturally. The current interactive API/UI can keep its data URL behavior until a separate serving change replaces it; Phase 0 must not break the working tool.

## 6. Discovery pipeline

### Stage A — safe fetch and canonicalization

1. Normalize the requested domain and try the supplied URL, apex HTTPS, apex HTTP, and a bounded `www` alternative when the bare apex fails.
2. For production, resolve DNS explicitly; reject private, reserved, link-local, CGNAT, benchmarking, and IPv4-mapped-IPv6 addresses; pin the checked address for the connection; and repeat validation on **every redirect hop and every candidate fetch**. Allow only HTTP(S) on ports 80/443, cap redirect hops explicitly, and retain response byte/time limits.
3. Record response status, final URL, content type, duration, and failure reason instead of swallowing all errors.
4. Cache raw HTML and response metadata for the duration of an experiment so reranking does not re-crawl the internet.
5. Apply low per-host concurrency, a descriptive user agent/contact URL, backoff, and an explicit terms policy. Batch fixture runs and expanded crawling honor RFC 9309 robots.txt; document the separate policy for a single user-directed lookup.

### Stage B — fast static discovery

Replace regex-only document parsing with one small, maintained HTML parser as an unconditional Phase 1 prerequisite. Header/nav ancestry, home-linked elements, malformed markup, and inline SVG require a real DOM tree; the regex path remains only to reproduce the fresh Phase 0 baseline.

Collect these sources in one pass:

1. Existing JSON-LD logo values, plus graphs and `ImageObject` URL/content URL forms.
2. `meta[property="og:logo"]`, `meta[itemprop="logo"]`, `img[itemprop="logo"]`.
3. `img` and `picture/source` URLs from `src`, `srcset`, `data-src`, `data-srcset`, common lazy-load attributes, and `<noscript>`.
4. External and self-contained inline SVG in `header`, `nav`, or a home-linked element.
5. Existing icon links plus `mask-icon`, manifest icon `purpose`, Apple touch icons, and Microsoft tile metadata.
6. `og:image` and Twitter image only as exclusion/diagnostic banner candidates, not automatic logos.

Defer same-document SVG `<use>` resolution and CSS `background-image` inspection until the Phase 0 failure taxonomy shows that either has enough potential wins to justify its edge cases.

Candidate semantic features:

- positive tokens in `id`, `class`, `alt`, `aria-label`, URL filename, and nearest link: `logo`, `brand`, company name;
- placement in header/nav and linking to the site's home page;
- visible/rendered dimensions when available, otherwise declared dimensions;
- negative tokens/regions: customer, partner, sponsor, testimonial, payment, app-store, flag, avatar, footer badge;
- occurrence across multiple crawled pages (strong evidence for a site-wide header logo).

### Stage C — cheap existing fallbacks

Run these in parallel after or alongside static validation:

1. Existing root favicon paths.
2. Optional self-hosted Besticon as a separately measured ablation.

BIMI and Simple Icons stay in the backlog for a future popular-brand cohort. Both are useful sources, but their expected coverage is near zero for the present long-tail startup fixture, so they should not consume this cycle.

Do not use Logo.dev, Brandfetch, Clearbit mirrors, Google S2, or other hosted logo APIs as ground truth for the open-source core. They can be comparison baselines in a separately labeled experiment if their terms permit it.

### Stage D — conditional page expansion

Only when the best `icon`/`wide` confidence remains below a threshold:

1. Follow at most two same-site links whose anchor text or URL indicates `about`, `company`, `press`, `media`, `brand`, or `newsroom`.
2. Prefer links actually present on the home page; do not blindly request a large dictionary of paths.
3. Reuse the same static extractor and boost assets repeated across pages.

This bounded step can recover press-kit wordmarks without turning Logo Yoink into a general crawler.

### Stage E — conditional rendered-browser fallback

Invoke Playwright only if static HTML has no strong candidate, contains an obvious client-app shell, or returns an anti-bot/interstitial response that a normal browser can legitimately access.

With one desktop viewport and a short bounded stabilization period:

- inspect visible header/nav candidates after hydration;
- read `currentSrc`, computed `background-image`, rendered boxes, visibility, and background color;
- serialize inline SVG with required definitions/styles;
- capture the evidence, not a screenshot crop, whenever the underlying asset is available;
- optionally repeat only the header inspection under `prefers-color-scheme: dark` to discover a real theme swap.

Do not use full-page computer vision in the first browser version. Record browser startup/render cost separately so quality gains can be weighed against throughput.

## 7. Validation, deduplication, and classification

### Validation

- Verify actual bytes rather than extensions or headers.
- Add robust SVG parsing and reject scripts, event handlers, external loads, active content, external entities, and entity expansion; disable DTD processing in the chosen XML path.
- Read WebP/AVIF dimensions through a focused image library if adopted; rasterize SVG only for analysis/contact sheets while preserving the original.
- Start with dimensions, aspect ratio, alpha presence, and blank/one-color detection. Add padding/content-bound, background, entropy, or photo-likelihood analysis only if labeled failures justify them.
- Enforce byte and pixel-count limits to avoid decompression bombs.
- Penalize tiny, extremely padded, blank, screenshot-like, or implausibly panoramic assets; do not reject wide wordmarks merely for being wide.

### Deduplication

Deduplicate in this order:

1. canonical resolved URL;
2. exact byte hash;
3. normalized SVG hash where safe;
4. perceptual hashing only if the residual duplicate rate after steps 1–3 is material.

Merge provenance and keep the strongest evidence when duplicates collapse. If perceptual hashing is later added, hash shape/alpha separately from color and compare light and dark composites so legitimate light/dark variants do not collapse.

### Role and theme classification

Use interpretable features first:

- `icon`: roughly square or intentionally maskable, usually little/no wordmark evidence;
- `wide`: a wordmark or symbol-plus-name lockup with a wide content box and strong logo evidence;
- `favicon`: icon-link/root source, regardless of whether it also qualifies as an icon.

`social_banner` and `other` are exclusion/diagnostic labels rather than ranked roles.

Theme evidence comes from manifest `purpose`, filenames/classes (`dark`, `light`, `inverse`, `white`), CSS media queries, picture/media selection, or the rendered background where it is used. Label uncertain cases `unknown`; do not infer that any black logo is a light-theme variant solely from pixel color.

## 8. Ranking design

Replace one global score with:

```text
candidate confidence = source evidence + semantic evidence + placement evidence
                     + company agreement + repeated-use evidence
                     + technical quality - negative evidence
```

Then compute role-specific scores. Examples:

- square shape raises `icon`, not generic correctness;
- header/home-link placement raises logo roles strongly;
- company/domain agreement can raise `wide` confidence, but only after Phase 0 measures how often fixture legal names match `title`, `og:site_name`, or the apex-domain token. Use token/prefix/acronym evidence rather than requiring exact legal-name equality;
- `og:image` is diagnostic banner evidence and has a low logo prior;
- favicon sources raise favicon/icon confidence but not `wide`;
- SVG and adequate resolution raise quality, not identity;
- partner/testimonial/footer-badge context heavily penalizes identity confidence.

Return the top result and runner-up per role when they are not near-duplicates. Include `score_reasons` and a low/medium/high confidence band. Tune weights against the labeled development subset; do not train or tune against the final holdout.

## 9. Experiment and evaluation protocol

### Ground truth and split

Use all 100 `original-100` companies as the development set; this preserves comparison with the historical cohort and avoids 20-company slices where one site moves a rate by five percentage points. Before tuning, select and freeze a deterministic seeded 100-company holdout from `additional-400`, but do not inspect or label it until the rules and weights freeze. The remaining 300 companies are the unlabeled scale/operations cohort.

Phase 0 records a reachability taxonomy for every development domain: live HTML, parked/for-sale, DNS/TLS failure, blocked/interstitial, redirected off-domain, or non-HTML. Report every quality metric with its denominator and show both reachable-domain and all-domain rates.

For each company, a reviewer labels discovered candidates rather than manually searching the entire web:

- identity: correct / wrong / ambiguous;
- role: icon / wide / favicon / banner-or-other;
- usability on light and dark backgrounds: good / conditional / unusable;
- defects: low resolution, padding, opaque box, cropped, blank, old brand, unrelated, fallback;
- best candidate per ranked role, if present.

“Correct identity” means the brand operated by the resolved final domain, not an exact string match to the fixture's legal entity name. Every manual label is keyed by stable `entity_id` and records reviewer and timestamp so rebrands are not silently treated as model regressions.

### Metrics

Primary:

- candidate recall per role: whether any correct candidate is present before ranking (the key discovery-versus-ranking diagnostic);
- correct top-1 rate per ranked role (`icon`, `wide`, `favicon`);
- usable top-1 rate per role on light and dark preview backgrounds;
- domain coverage with at least one correct discovered asset;
- wrong-brand top-1 rate (the most serious quality failure).

Secondary:

- duplicate rate and average candidates shown;
- static-only versus browser-assisted gain;
- p95 latency and total batch wall time, requests/domain, downloaded bytes/domain, and browser invocation rate;
- failure distribution by taxonomy.

Do not use “square and at least 128 px” as the main quality metric. Retain it only for comparison with the historical benchmark.

Run the fresh Phase 0 configuration twice and publish the number of domains whose outcome flips. No later gate may be smaller than this observed noise floor. Every comparison also publishes a per-domain win/loss table: a `+6/−4` change and a `+2/−0` change have the same net result but different risk.

### Reproducible run artifacts

Each benchmark run writes to a timestamped directory:

```text
runs/<run-id>/
  config.json
  results.jsonl
  summary.json
  assets/<content-hash>.<ext>
  contact-sheets/
  failures.csv
```

`config.json` includes git revision, cohort IDs, extractor flags, timeouts, concurrency, user agent, browser version, and scoring weights. `results.jsonl` records all candidates and failures. Cached inputs allow rescoring without network drift.

`runs/` is local-only and must be added to `.gitignore`; it contains harvested third-party assets. Only aggregate summaries without asset bytes/data URLs are candidates for source control. Contact sheets use sanitized/rasterized previews and never inline an untrusted fetched SVG into a page the reviewer opens.

### Visual inspection

Generate one contact sheet per 20–25 companies and one failure-only sheet. Each candidate tile shows:

- rasterized image on white and near-black backgrounds;
- company/domain, source, predicted role/theme, dimensions/format, total score, and short score reasons;
- stable candidate ID for labeling.

Use a rasterization of the original asset inside a fixed viewport with visible bounds; do not stretch it. Review top-1 plus the first distinct runner-up per role. One reviewer labels the full set and performs a separate second pass over wrong-brand/ambiguous calls. If a second person is available, use a small calibration sample rather than making two-reviewer staffing a release requirement.

## 10. Phased implementation and stop/go gates

### Phase 0 — make the baseline reproducible (small)

Deliver:

- batch runner for fixture cohorts;
- saved run schema, explicit reachability/failure reasons, and cached raw inputs/assets;
- contact-sheet generator and labeling file keyed by `entity_id`;
- fresh 100-company baseline, run twice, plus a per-domain flip count;
- isolated measurements for two baseline fixes: truncate oversized HTML after preserving the useful prefix, and try a bounded `www` alternative;
- measurement of fixture-name agreement with `title`, `og:site_name`, and apex-domain tokens.

Gate: every domain has an explicit outcome; the reachable denominator and run-to-run noise floor are known; and candidate labels show whether each miss is primarily discovery or ranking. Reconfirm Phase 1 scope from this evidence.

### Phase 1 — visible static logos (highest expected gain)

Adopt the HTML parser, then implement separate offline ablations over the Phase 0 HTML cache so discovery comparisons do not re-crawl or inherit network noise:

1. metadata additions (`og:logo`, microdata, broader JSON-LD);
2. role-separated scoring and negative-context features applied to existing sources;
3. DOM header/nav `img`, `picture`, lazy-load, and `srcset` discovery;
4. self-contained inline/external SVG in header/nav/home-linked elements;
5. exact byte/normalized-SVG deduplication and blank/one-color detection.

Step 2 lands before or with step 3 because the current square bonus would otherwise make newly discovered wide logos look like a regression. Gate: improve usable correct top-1 for `wide` by more than the measured Phase 0 flip count with no increase in wrong-brand top-1. A source family that adds only noisy candidates is removed or demoted.

### Phase 2 — bounded multi-page fallback

Add bounded discovery of linked brand/about/press pages. Test optional self-hosted Besticon as a separate ablation. Leave BIMI, Simple Icons, CSS backgrounds, and SVG `<use>` resolution in the backlog unless measured failure clusters predict useful wins.

Gate: each added source produces a measurable unique win on development/validation, or remains opt-in. Do not keep sources merely because they find more files.

### Phase 3 — conditional browser

Only if the Phase 0/2 taxonomy shows a material JS-only candidate gap, add the Playwright adapter for low-confidence/JS-only cases, including rendered visibility and optional dark-mode header inspection.

Gate: report incremental correct assets, browser invocation rate, latency, and bytes. Keep it conditional only if the quality gain justifies operational cost.

### Phase 4 — frozen development, holdout, then scale

1. Freeze rules and weights.
2. Label and run the frozen 100-company holdout from `additional-400`; report without tuning.
3. If wrong-brand rate and primary metrics meet the agreed targets, run the remaining 300-company scale cohort with conservative concurrency and caching.
4. Review every wrong-brand top-1 plus a stratified sample of successes.
5. Turn failure clusters—not anecdotes—into the next experiment backlog.

Set numeric quality and cost targets only after Phase 0 establishes reachability, baseline accuracy, network noise, and request/byte distributions. Express targets as percentages of reachable domains, with all-domain figures beside them. The standing non-numeric gates are: improve beyond the measured flip count, do not increase wrong-brand top-1, and keep only sources whose unique wins justify their requests/latency.

## 11. Minimal implementation shape

Keep the current application and split only where responsibilities have become real:

```text
src/
  extractor.mjs        orchestration and public API
  discover-static.mjs  HTML/metadata/DOM discovery
  discover-browser.mjs optional Playwright adapter
  validate-image.mjs   safe fetch, metadata, analysis, hashes
  rank.mjs             role classification and explainable scores
scripts/
  benchmark.mjs
  contact-sheet.mjs
fixtures/
  companies-500.json
  labels.jsonl        keyed by entity_id
```

Likely dependencies should be limited to one HTML parser, one image processing library capable of safe metadata/rasterization/hashing, and Playwright only when Phase 3 begins. Benchmark each addition against a concrete need; do not introduce a queue, database, microservices, vector store, or ML stack for the 500-company experiment.

## 12. Risks and controls

| Risk | Control |
|---|---|
| Wrong customer/partner logo wins | Header/home-link and company-agreement evidence; negative regions; wrong-brand metric as a hard gate |
| Rebrands make labels stale | Store retrieval/label dates, final URL, and reference evidence; permit explicit relabeling |
| SVG active content or decompression bombs | Sanitize before rendering/serving; byte, pixel, redirect, and timeout limits |
| SSRF and DNS rebinding | Reject all non-public address ranges; pin the checked address; revalidate every redirect/candidate fetch; allow only HTTP(S) ports 80/443; cap redirects |
| Browser cost dominates | Conditional invocation, shared browser process, bounded page count/time, and explicit cost metrics |
| Crawling causes load or violates policies | Cache, rate-limit, identify the crawler, respect applicable robots/terms, and provide removal/update mechanisms |
| Open-source license or trademark confusion | Record code provenance/licenses; keep asset provenance; publish a trademark disclaimer and takedown/update process; never call harvested logos “open source” or imply that the software license grants logo/trademark rights |
| Harvested assets accidentally committed | Add `runs/` to `.gitignore`; commit aggregates only; use rasterized contact-sheet previews |
| Fixture data rights are unclear | Confirm the 500 name/domain pairs are publicly derivable or cleared for redistribution before promoting the public repository |
| Public server becomes an unauthenticated fetch proxy | Keep localhost-only until SSRF controls, rate limits, response-size controls, and authentication/abuse policy exist |
| Benchmark overfitting | Fixed 100-domain development and 100-domain holdout cohorts, offline ablations, frozen final run, and separate 300-domain scale check |

## 13. Immediate next actions

1. Implement Phase 0 only: batch artifacts, HTML cache, reachability census, failure taxonomy, candidate-recall labels, and contact sheets.
2. Establish a fresh 100-company baseline twice and publish the flip count; do not try to recreate the uncommitted 2026-08-22 harness.
3. Measure the oversized-HTML and `www` fixes independently, and measure whether fixture legal names are useful scoring evidence.
4. Freeze a seeded 100-company holdout from `additional-400` without inspecting it.
5. Reconfirm Phase 1 from the discovery-versus-ranking failure split, then run one offline source-family ablation at a time.

## 14. Review log

Two independent Claude Code reviews were run locally against this document and the repository on 2026-08-22: one with the installed current `opus` alias and one with the installed current `fable` alias. “Claude Code” is the review client rather than a separate model; the two model runs supplied independent perspectives.

Changes incorporated from both reviews:

- replaced the statistically weak 60/20/20 split with 100 development, 100 frozen labeled holdout, and 300 scale domains;
- stopped treating the historical aggregate table as reproducible and added a reachability census, repeated runs, flip count, and win/loss table;
- reduced first-cycle ranked roles to `icon`, `wide`, and `favicon`;
- made the HTML parser a Phase 1 prerequisite and reordered scoring before new wide-logo discovery;
- moved BIMI/Simple Icons, CSS backgrounds, SVG `<use>` resolution, and perceptual hashing behind evidence-based gates;
- added oversized-HTML and `www` baseline experiments, fixture-name agreement measurement, local-only run artifacts, rasterized contact sheets, and more explicit SSRF/DNS-rebinding controls;
- removed arbitrary success percentages until Phase 0 establishes honest denominators and a noise floor.
