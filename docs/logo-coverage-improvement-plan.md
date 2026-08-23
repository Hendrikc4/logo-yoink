# Logo Coverage Improvement Plan

**Date:** 2026-08-22

**Status:** Research and implementation plan only; no discovery mechanisms are implemented here

**Scope:** Increase correct square/icon and full/wide logo coverage while protecting identity precision, crawl safety, and operating cost

## Executive summary

Logo Yoink already has a strong, conservative static extractor. It understands icon links, manifests, structured data, semantically named images, responsive images, inline SVG, home-linked header elements, and a small set of secondary pages. It validates downloaded assets, ranks icon and wide roles separately, and can optionally use a hydrated browser. The frozen 500-company run reached 423 domains and selected an icon for 365 companies (73.0%) and a wide logo for 249 (49.8%). On the only human-labeled cohort, selected precision was 90.9% for icons and 88.1% for wide logos.

The largest opportunity is not a new logo database. It is a safer, role-aware pipeline that preserves more evidence, gives wide candidates their own budget, extracts first-party CSS/theme variants, and escalates only unresolved cases to targeted brand pages or a browser. The largest current risk is identity drift: seven reachable development domains selected a logo belonging to a parked, expired, redirected, or unrelated site. Coverage improvements must therefore be gated on wrong-brand safety before raw availability.

The recommended order is:

1. Add identity quarantine, multi-evidence candidate records, role-aware budgets, and complete human labels.
2. Add tightly scoped CSS and theme extraction, plus inexpensive icon metadata conventions.
3. Improve explicit press/brand-page discovery and run the browser asynchronously only for unresolved wide logos.
4. Test BIMI, verified domain-to-app links, and exact-domain Wikidata as bounded auxiliary sources.
5. Keep OCR, archive/search-index recovery, document archives, and screenshot-derived logos experimental until the simpler sources plateau.

The combined quick-win and medium-investment hypothesis is **+2 to +7 percentage points for icons** and **+6 to +15 points for wide logos** on all 500 domains, before accounting for overlap. These are non-additive ranges to test, not promises. Correct-and-usable coverage—not the presence of any selected image—is the deciding metric.

## 1. Audit of the current system

### 1.1 Frozen baseline

The current evidence is documented in [the execution report](./benchmark-execution-2026-08-22.md) and [the original discovery plan](./logo-discovery-plan.md).

| Cohort | Domains | Reachable | Icon selected | Wide selected | Favicon selected |
|---|---:|---:|---:|---:|---:|
| Development | 100 | 80 | 66 | 42 | 67 |
| Holdout | 100 | 86 | 76 | 57 | 73 |
| Remaining | 300 | 257 | 223 | 150 | 214 |
| All frozen companies | 500 | 423 | 365 (73.0%) | 249 (49.8%) | 354 (70.8%) |

The development cohort is the only cohort with completed human review. Its selected precision is 60/66 (90.9%) for icons and 37/42 (88.1%) for wide logos. The reported 57.26/100 quality score combines discovery and quality outcomes, but the existing labels do not establish candidate-pool recall because they cover selected candidates rather than all plausible candidates.

Two prior ablations establish useful boundaries:

- Expanding to more generic secondary pages added one icon and one wide selection, but the additions were a UI glyph and an about-page photograph. It also increased requests by about 10%, bytes by 17%, and p95 latency by 14%. Generic expansion should remain disabled.
- Browser hydration raised wide availability on the development cohort from 39 to 45 with six visually strong additions, but requests rose from 1,066 to 4,185, bytes from 99 MB to 156 MB, and p95 latency from 5.22 s to 7.70 s. It is a useful escalation path, not a default synchronous stage.

Seven development domains produced wrong-brand top selections. Their pattern—expired or repurposed domains, parking, unrelated redirects, and third-party UI—makes identity safety a prerequisite for further recall work.

### 1.2 Static discovery

[`src/discover-static.mjs`](../src/discover-static.mjs) currently extracts:

- standard icon, shortcut icon, Apple touch icon, mask icon, and manifest links;
- JSON-LD organization/brand logos and microdata logo values;
- Open Graph-like logo metadata, Microsoft tile images, and related metadata;
- `img` sources, lazy-source attributes, `srcset`, `picture` sources, and `noscript` content;
- self-contained inline SVG with semantic or home-link evidence;
- semantic context from logo/brand/wordmark tokens, header/navigation ancestry, home links, and company-name tokens;
- negative context for partners, customers, sponsors, testimonials, payments, app stores, badges, avatars, awards, flags, and UI controls;
- explicit secondary links for brand, press, media, newsroom, about, and company pages.

This is an unusually complete static baseline. Its principal gaps are:

- no external or embedded stylesheet traversal for `background-image`, `image-set()`, `mask-image`, pseudo-elements, or CSS variables;
- no resolution of external SVG sprites or `<use>` references;
- exact-host home-link checks rather than registrable-domain-aware comparisons;
- no open shadow-root, iframe, object/embed, or canvas discovery;
- all candidate types share a small global download budget, so abundant icon candidates can crowd out wide candidates;
- generic about/company pages are mixed with high-intent brand/press pages;
- provenance is reduced during URL and byte deduplication instead of accumulated.

The negative `app-store` context is useful against badges, but it can also suppress a legitimate first-party app icon. That distinction should be expressed as role and evidence, not a single negative token.

### 1.3 Network, extraction, and validation

[`src/extractor.mjs`](../src/extractor.mjs) provides bounded HTML/image fetching, redirect handling, private-address checks, parking detection, manifest discovery, optional Besticon, conventional favicon probes, byte/type validation, hash deduplication, ranking, secondary-page escalation, and optional browser escalation.

Important gaps are:

- the DNS check occurs before the subsequent HTTP connection resolves the hostname. This check-then-connect race does not fully prevent DNS rebinding or a changed resolution;
- off-domain final redirects are categorized but still feed discovery and ranking rather than entering quarantine;
- the configured benchmark user agent is recorded and passed as an option, but the static request path uses a hard-coded crawler user agent;
- URL deduplication keeps the strongest single candidate and loses weaker, corroborating evidence; hash deduplication only partially merges provenance;
- the top-16 download limit is global, not reserved by role or source class;
- SVG safety checks are intentionally shallow and should not be treated as a complete sanitizer for arbitrary rendering contexts;
- stored run artifacts include derived assets and results, but not a reusable, content-addressed snapshot of every HTML, manifest, CSS, DNS, and browser observation needed for cheap offline ranking ablations.

### 1.4 Browser discovery

[`src/discover-browser.mjs`](../src/discover-browser.mjs) uses Playwright with isolated pages, resource limits, service-worker blocking, a hydration delay, light/dark emulation, visible header/navigation/home-link scoping, inline-SVG serialization, and computed background-image inspection.

It does not yet inspect pseudo-elements, CSS masks, generated `content`, open shadow roots, same-origin frames, canvas pixels, or all `currentSrc`/theme transitions. It blocks fonts and other expensive resources, which is operationally sensible but can change wordmark layout. Network-byte accounting is incomplete for responses without `Content-Length`. A browser remains the right tool for JS-only sites, but its measured cost argues for asynchronous cache warming or a missing-wide queue.

### 1.5 Ranking and output model

[`src/rank.mjs`](../src/rank.mjs) combines source weights, semantic/header/home/company evidence, negative context, visual quality, and aspect ratio. It produces separate icon, wide, and favicon scores with a minimum threshold.

The current score conflates three different questions:

1. Does this asset belong to the intended company?
2. Is it an icon, wide logo, or favicon?
3. Is it technically usable on a particular background?

Consequences include:

- dimensions and whole-canvas aspect ratio can dominate without measuring the non-transparent content box;
- one strong contextual clue can compensate for weak identity evidence;
- theme variants are not grouped or selected per background;
- repeated independent observations are not rewarded cleanly;
- source-page authority and current-domain corroboration are not modeled;
- the API returns one winner per role instead of an asset family with alternates and confidence reasons.

### 1.6 Benchmark and review tooling

The benchmark scripts provide deterministic cohort selection, JSONL output, content-addressed assets, run configuration, summary/failure reports, paired comparisons, contact sheets, and light/dark montage rendering. These are good foundations.

The central labeling flaw is that the reviewer-label builder treats unlisted selected candidates as correct/good and only records exceptions. It also reviews mostly top selections. As a result:

- unlabeled is indistinguishable from affirmed;
- candidate-pool recall cannot be measured independently of ranking;
- a ranking change can make apparent recall change even when discovery did not;
- light and dark usability are not consistently separate fields;
- wrong identity, wrong role, and poor rendering are not cleanly separated.

This must be corrected before optimizing small coverage differences.

### 1.7 Audit verification note

The repository source, docs, fixtures, labels, and scripts were inspected directly. The eight browser-discovery tests passed in this worktree. The extractor and benchmark suites could not start because the local dependency installation is absent and `sharp` cannot be resolved; no dependencies were installed because this task is plan-only. This is an environment limitation, not evidence of a product regression.

## 2. Research findings and source/license notes

The research below uses standards, official platform documentation, primary datasets, and source repositories. It does not assume or infer Logo.dev's private implementation.

### 2.1 Web and identity standards

| Source | Relevant opportunity | Status or license note |
|---|---|---|
| [WHATWG link types](https://html.spec.whatwg.org/dev/links.html) and [responsive images](https://html.spec.whatwg.org/multipage/images.html) | Preserve icon metadata and browser-selected `currentSrc`; resolve `picture`/`srcset` accurately | Living web standards |
| [W3C Web App Manifest](https://www.w3.org/TR/appmanifest/) | Use icon `purpose` (`any`, `maskable`, `monochrome`), sizes, and related theme metadata | W3C Recommendation/current specification; manifest icons are icon evidence, not wide-logo evidence |
| [Apple pinned tabs](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/pinnedTabs/pinnedTabs.html) and [touch-icon conventions](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html) | Mask icons and conventional root touch icons can improve square/icon recall | Archived official Apple documentation; verify behavior in current browsers, and treat artwork as trademarked site content |
| [Open Graph protocol](https://ogp.me/) | `og:image` and `og:site_name` can corroborate identity | `og:logo` is not part of the official core protocol; retain it only as a weak extension signal |
| [Schema.org `logo`](https://schema.org/logo) and [`sameAs`](https://schema.org/sameAs) | Structured logo and verified external-account discovery | Schema vocabulary; linked media retain their own rights |
| [CSS Images Level 4](https://www.w3.org/TR/css-images-4/), [CSS Masking](https://www.w3.org/TR/css-masking-1/), and [Media Queries Level 5](https://www.w3.org/TR/mediaqueries-5/) | Extract `image-set`, masks, generated/theme-specific assets, and `prefers-color-scheme` branches | W3C specifications; implementation support must be feature-tested |
| [SVG 2](https://www.w3.org/TR/SVG2/) and [SVG conformance modes](https://www.w3.org/TR/SVG2/conform.html) | Resolve safe local references and enforce a secure-static subset | W3C specifications; never render untrusted active SVG directly in review pages |
| [Sitemaps protocol](https://www.sitemaps.org/protocol.html) | Find a small number of explicit `/brand`, `/press`, `/media`, or `/newsroom` URLs without broad crawling | Protocol documentation; robots and site policy still apply |
| [BIMI Internet-Draft](https://datatracker.ietf.org/doc/draft-brand-indicators-for-message-identification/), [BIMI implementation guide](https://bimigroup.org/implementation-guide/), and [SVG guidance](https://bimigroup.org/creating-bimi-svg-logo-files/) | `default._bimi` can expose a square SVG; a VMC/CMC can increase identity confidence | As of 2026-08-22 BIMI is an Internet-Draft, not an RFC. Self-asserted records are weaker than certificate-backed records. Artwork/trademark rights remain with the brand |

### 2.2 Domain-to-app and public knowledge sources

| Source | Practical use | Rights/operational note |
|---|---|---|
| [Android Digital Asset Links](https://developer.android.com/training/app-links/configure-assetlinks) | `.well-known/assetlinks.json` supplies package names and certificate fingerprints that strongly associate a domain and Android app | Official Android format; association is identity evidence, not permission to copy store artwork |
| [Apple associated domains](https://developer.apple.com/documentation/Xcode/supporting-associated-domains) and [Smart App Banner/App Clip metadata](https://developer.apple.com/documentation/appclip/supporting-invocations-from-your-website-and-the-messages-app) | Associate a domain with app identifiers and discover explicit first-party app references | Official Apple documentation; do not infer unrestricted artwork reuse |
| [Apple Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/index.html) | Could technically resolve app artwork after a verified association | Apple's promotional-content terms constrain use around promoting store content. Do **not** make App Store artwork a generic logo source without legal approval and compliant presentation |
| [Wikidata data access](https://www.wikidata.org/wiki/Wikidata:Data_access), [logo property P154](https://www.wikidata.org/wiki/Property:P154), and [official website P856](https://www.wikidata.org/wiki/Property:P856) | Exact P856-domain matching can locate P154 logos or corroborate identity | Wikidata structured data is CC0. Wikimedia files have per-file licenses, and [Commons reuse guidance](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia/en) notes separate attribution, copyright, personality, and trademark obligations |
| [GitHub organization API](https://docs.github.com/en/rest/orgs/orgs), [repository contents API](https://docs.github.com/en/rest/repos/contents), and [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) | An organization explicitly linked by `sameAs` or a first-party repository can provide an avatar or branded README asset | Use only with reciprocal domain or verified-organization evidence; respect API terms/rates and GitHub's [Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) |
| [npm `package.json`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json) | `homepage` and `repository` can help corroborate official developer projects | There is no standard package-logo field; low expected value and package-squatting risk make npm unsuitable as a direct source |
| [RDAP response format, RFC 9083](https://www.rfc-editor.org/rfc/rfc9083.html) and [IANA DNS RDAP bootstrap](https://www.iana.org/assignments/rdap-dns/) | Recent registration/transfer events can raise risk for an apparently repurposed domain | Registration age is only a risk feature, never proof of identity. RDAP availability and redaction vary |

### 2.3 Open-source implementations and datasets

Repository popularity is not treated as correctness. Before copying any code, pin the revision, re-check the license at that revision, preserve required notices, and conduct a dependency/security review. Reimplementing a small standard-derived heuristic is often safer than importing a crawler.

| Project | What it contributes | License/recommendation |
|---|---|---|
| [Besticon](https://github.com/mat/besticon) | Mature favicon discovery/scoring comparator already supported optionally | MIT. Keep as an ablation/comparator; prior unique gains were small and favicon-oriented |
| [metascraper-logo](https://github.com/microlinkhq/metascraper/tree/master/packages/metascraper-logo) | Metadata-based logo rules | MIT. Current Logo Yoink already covers most relevant rules; compare tests rather than add the dependency |
| [Dembrandt](https://github.com/dembrandt/dembrandt) | Browser-computed design/asset extraction patterns | MIT. Useful design reference for computed CSS; do not adopt a broad browser-first architecture |
| [logo-extractor](https://github.com/1e0h/logo-extractor) | Young crawler combining static and visual heuristics | MIT at the inspected revision. Most heuristics are already present; treat as a test-corpus/reference source, not proven coverage evidence |
| [logo-downloader](https://github.com/robtaylor/logo-downloader) | Press/brand paths, direct asset links, CSS, and archive ideas | MIT. Very young and lightly used; validate ideas independently rather than copying its pipeline |
| [branding-go](https://github.com/julianmarshall911/branding-go) | Small Go implementation of common metadata/icon rules | Apache-2.0. Largely subsumed by the current extractor |
| [Public Suffix List](https://github.com/publicsuffix/list) / [tldts](https://github.com/remusao/tldts) | Correct registrable-domain comparison | PSL is MPL-2.0; `tldts` is MIT. A small maintained library is preferable to hand-rolled suffix parsing, but adds update cadence and bundle cost |
| [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) | Local text recognition for company-name corroboration | Apache-2.0. Use only as an optional ranking/safety signal after measuring stylized-wordmark failures |
| [OpenCV](https://opencv.org/license/) | Content bounding boxes and image morphology | Apache-2.0 for current versions. Sharp/handwritten alpha-bound calculations may be sufficient initially |
| [SVGO](https://github.com/svg/svgo) | SVG normalization and optimization | MIT. Sanitize before optimization; optimization is not security validation |
| [Simple Icons](https://github.com/simple-icons/simple-icons) | Curated icons for popular brands | CC0 data, with an explicit trademark disclaimer. Poor fit for long-tail startups and not a substitute for first-party discovery; consider only an opt-in external fallback |
| [WebLogo-2M](https://weblogo2m.github.io/) and its [paper](https://openaccess.thecvf.com/content_ICCV_2017_workshops/w5/html/Su_WebLogo-2M_Scalable_Logo_ICCV_2017_paper.html) | Research corpus for logo recognition | Dataset site restricts use to academic research and notes noisy labels/copyright held by owners. Do not use it for product training or asset delivery |
| [verifybimi.com](https://github.com/dconroy/verifybimi.com) | Example BIMI lookup/validation code | MIT. Small/young project; implement against the current draft and official guidance, using this only as a cross-check |

### 2.4 Search indexes, archives, and caches

[Common Crawl](https://commoncrawl.org/get-started) publishes crawl data and a [URL index](https://index.commoncrawl.org/). It can recover an old asset URL or explain a now-empty JS shell without querying a search engine. Its results are stale by definition and may represent a former owner of a domain. A Common Crawl hit must never outrank a current first-party observation without current-domain corroboration. Use it experimentally, cache queries, respect index rate limits, and retain crawl timestamp/provenance.

Commercial web/image search APIs may find official press-kit pages with `site:domain brand assets` queries, but introduce per-query cost, terms restrictions, result instability, and prominent wrong-brand/partner results. They should be a separate, opt-in comparator after first-party mechanisms plateau—not a core crawler dependency. Scraping consumer search result pages or social networks is not recommended.

## 3. Proposed architecture and data-model changes

### 3.1 Separate identity, role, and usability

Every candidate should pass three independently inspectable stages:

1. **Identity gate:** probability/evidence that the asset belongs to the requested company and current domain.
2. **Role ranking:** evidence that it is an icon, wide/full logo, or favicon.
3. **Usability classification:** renderability, resolution, transparency, padding, and background/theme compatibility.

A candidate that fails the identity gate cannot win merely because it is square or named `logo.svg`. An asset that is correct but white-on-transparent should remain available as a dark-background variant rather than be called globally bad.

### 3.2 Candidate record

The data model should preserve observations instead of collapsing them prematurely:

```json
{
  "candidate_id": "sha256:...",
  "content_hash": "sha256:...",
  "urls": ["https://..."],
  "observations": [
    {
      "source": "dom_img",
      "page_url": "https://example.com/",
      "selector_scope": "header > a[href=/]",
      "semantic_tokens": ["brand", "logo"],
      "theme": "light",
      "observed_at": "2026-08-22T00:00:00Z"
    }
  ],
  "identity": {
    "status": "accepted",
    "score": 0.97,
    "positive": ["same_registrable_domain", "home_link", "org_name_match"],
    "negative": []
  },
  "roles": {
    "icon": {"score": 0.11},
    "wide": {"score": 0.92},
    "favicon": {"score": 0.02}
  },
  "visual": {
    "canvas": {"width": 640, "height": 120},
    "content_box": {"width": 586, "height": 72},
    "alpha": true,
    "usable_on": ["light"],
    "quality_flags": []
  },
  "asset_family": "family:...",
  "license_provenance": "first_party_page_reference"
}
```

`observations` should accumulate manifest, DOM, CSS, JSON-LD, press-page, BIMI, and browser evidence for identical URLs or bytes. The system should retain distinct bytes for light/dark or icon/full variants and group them into an `asset_family` through normalized SVG/image similarity only after conservative measurement.

### 3.3 Identity state machine

Use explicit states rather than a continuous score alone:

- **accepted:** final page remains on the requested registrable domain, or an off-domain canonical site is corroborated by structured/current first-party evidence; the company/site identity is consistent;
- **quarantined:** off-domain redirect, parking signal, strong organization-name mismatch, recently repurposed-domain risk, or unrelated page topic; candidates are recorded but cannot be returned;
- **unresolved:** insufficient evidence, network failure, or ambiguous acquisition; may enter a second-pass queue;
- **rejected:** known partner/UI/third-party identity or unsafe content.

Compare registrable domains using a maintained Public Suffix List implementation. Do not equate a valid TLS certificate with company identity: domain-validated TLS establishes control of a name, not the organization behind it; see the [CA/Browser Forum Baseline Requirements](https://cabforum.org/working-groups/server/baseline-requirements/requirements/).

Positive identity evidence can include exact current-domain linkage, a home-linked header placement, consistent `title`/`og:site_name`/JSON-LD organization name and URL, repeated use across first-party pages, and certificate-backed BIMI. Negative evidence includes unexpected final registrable domains, parking language, unrelated organization tokens, affiliate/partner context, recent registration combined with mismatch, and visually dominant third-party UI.

### 3.4 Role-aware candidate budgets

Replace the global top-16 download cutoff with small reserved queues, for example:

- 6 icon candidates;
- 8 wide candidates;
- 4 favicon candidates;
- 4 shared high-confidence structured candidates.

The exact limits require an ablation. This prevents manifest/icon abundance from consuming the entire budget before header wordmarks are validated. Deduplicate the network request but let one fetched asset participate in multiple roles.

### 3.5 Wide-logo safeguards

Wide-logo recall should grow through better first-party evidence, not by relaxing the current negative filter. A body image should become wide-eligible only when at least two independent identity signals are present, such as:

- semantic `logo`/`wordmark` plus current-home link;
- explicit brand/press page plus filename/company token;
- repeated identical bytes in the homepage header and a brand page;
- organization metadata plus OCR/company-name agreement;
- a high-confidence header placement plus a theme-paired sibling.

Keep partner/customer/testimonial/payment/app-store/social-share/footer badges ineligible unless the same bytes also appear in a trusted header/home/structured position. Measure the non-transparent content box before applying aspect-ratio bonuses; a square canvas containing a thin wordmark or a huge transparent margin should not be misclassified.

### 3.6 Theme variants

Render every high-ranked transparent candidate over at least white, near-black, and checkerboard backgrounds. Record contrast and visible-content bounds rather than one global usability flag. Observe `prefers-color-scheme`, `picture` media branches, CSS variables, and browser-computed URLs in both themes only when the static result is ambiguous or one-background-only.

Return a default plus explicit variants:

```json
{
  "wide": {
    "default": "candidate-a",
    "variants": {
      "on_light": "candidate-a",
      "on_dark": "candidate-b"
    }
  }
}
```

Do not synthesize inverted artwork by default. Derived recoloring can violate brand rules and hide multicolor details.

## 4. Researched opportunity evaluation

Ranges below are hypotheses over the frozen 500-company cohort. They are deliberately conservative, overlap with one another, and must not be summed mechanically.

| Opportunity | Expected incremental coverage | Precision risk | Engineering effort | Latency/network cost | Legal/trademark considerations | Controlled measurement |
|---|---|---|---|---|---|---|
| Identity quarantine and registrable-domain redirects | 0 to -2 pp raw selection; large reduction in false coverage | Low if unresolved is preserved; false quarantine risk | Medium | Small; optional RDAP adds one cached lookup | PSL/library notices; RDAP data use | Replay seven known wrong-brand cases, then paired dev/holdout. Gate on wrong-brand reduction and false quarantines |
| Multi-evidence records and role-aware budgets | Icon +0–2 pp; wide +1–4 pp | Low | Medium | Same or slightly more downloads, with hard caps | None beyond existing asset provenance | Offline ranking replay plus discovery run; count candidates rescued beyond old top 16 |
| Root touch icon and `browserconfig.xml` metadata | Icon +0–1.5 pp | Low to medium; generic defaults | Low | At most two conditional requests | First-party assets; trademark remains with owner | Source-only ablation; require correct unique wins and no default-template selections |
| Scoped inline/same-origin CSS images, `image-set`, masks, and pseudo-elements | Icon +0–2 pp; wide +2–6 pp | Medium if all decorative images are admitted | Medium | 0–3 CSS requests; parsing CPU | First-party-referenced CDN assets are usable evidence, not freely licensed | Only header/nav/home-linked scopes; label every unique win and sample rejected candidates |
| External SVG sprite/`use` resolution | Icon +0–1 pp; wide +0–2 pp | Medium; UI sprite contamination | Medium | Usually one SVG request | Sanitize secure-static subset; first-party rights | Require semantic/home scope and content bounding box; stop if UI precision falls below gate |
| Targeted brand/press/media/newsroom pages | Wide +1–4 pp | Medium; press pages contain partner/news assets | Medium | 1–3 HTML requests; optional sitemap | Respect robots; press files still trademarked/copyrighted | Explicit paths versus current page expansion; prohibit generic `about/company` in first experiment |
| Sitemap-assisted high-intent page discovery | Wide +0–2 pp | Medium | Medium | One sitemap plus selected page, cached | Respect robots/site policy | Test only domains missing wide; require incremental correct usable wins over direct-link discovery |
| Async browser for missing/low-confidence wide | Wide +2–6 pp; icon +0–2 pp | Low to medium with current scoping | Medium | High: measured ~4x requests in dev ablation | Page terms; no anti-bot bypass | Queue-only ablation, track browser invocations and unique wins; never block normal request path |
| Browser shadow DOM, same-origin frame, pseudo/mask/currentSrc support | Wide +1–4 pp within browser-eligible subset | Medium | Medium-high | Incremental browser CPU/requests | Same constraints as browser crawl | One feature flag per mechanism; manually label all new candidates |
| BIMI `default` selector | Icon +0.5–2 pp | Medium for self-asserted records; lower with VMC/CMC | Medium | One cached DNS TXT plus SVG request | Draft standard; logos/trademarks not licensed by DNS publication | Separate self-asserted and certificate-backed precision; require exact organizational-domain mapping |
| Android/Apple domain-app association | Icon +0–1 pp directly; better identity corroboration | Medium; apps can be acquired or unrelated subbrands | Medium-high | 1–3 well-known/metadata requests | Store artwork cannot be assumed reusable; Apple promotional restrictions | First measure association prevalence. Only test first-party-hosted icons; no store scraping |
| Exact-domain Wikidata P856 + P154 | Icon +0–1.5 pp; wide +0–1 pp | Low to medium with exact match; stale data | Medium | Batched/rate-limited API; cache long | Structured data CC0; each Commons file license and trademark must be checked/recorded | External-source cohort ablation; no selection without exact-domain and current-site corroboration |
| Verified/reciprocal GitHub organization or repository assets | Icon +0–1 pp; wide +0–1 pp | Medium; unofficial orgs/forks | Medium-high | API calls and rate limits | GitHub terms; repository file licenses vary; avatars are not automatically open | Only first-party `sameAs`/repo links plus reciprocal/verified evidence; label every use |
| OCR company-name corroboration | Usually 0 direct pp; may safely unlock +1–3 pp wide | Medium: stylized marks, abbreviations, multilingual names | Medium-high | Local CPU; no network | Tesseract Apache-2.0; recognized text itself is factual | Shadow-score first; measure true/false matches on all labeled wide candidates before affecting rank |
| Alpha/content-box and perceptual family analysis | +0–2 pp through better role/theme choice | Low | Medium | Local CPU | OpenCV optional; implement simply first | Offline replay; theme and role confusion matrix |
| Canvas/element screenshot fallback | Wide +0–2 pp | High: derived UI fragments and resolution loss | High | Browser screenshot/CPU/storage | Derived screenshot may capture non-logo copyrighted content | Experimental only; require semantic element, correct OCR/name, and 95% labeled precision |
| Safe press ZIP/PDF extraction | Wide +1–4 pp among brands with kits; likely <2 pp overall | Medium; old/co-brand assets | High | Large files and decompression risk | Per-file rights, brand guidelines, and archive licenses vary | Prevalence survey first; strict sandbox/limits; stop unless ≥5 kits in dev+holdout yield unique current logos |
| Common Crawl/index recovery | +0–2 pp | High from stale/former owners | High | External index/object-storage traffic | Follow dataset terms; archived assets retain rights | Diagnostic/shadow mode only; current-domain corroboration required; measure age and identity errors |
| Commercial search/image APIs | +0–3 pp | High without strict domain validation | High ongoing cost | One or more paid queries per miss | API terms, caching limits, result copyrights | Separate opt-in comparator after first-party plateau; stop on any unquarantined wrong-brand selection |
| Simple Icons/external brand catalogs | <1 pp for this long-tail cohort | Low identity risk for known brands, high freshness/variant risk | Low-medium | Low | CC0 data does not waive trademark; incomplete long-tail coverage | Coverage inventory only; do not blend into default first-party results |
| Logo-recognition datasets/model | Unknown | High domain shift and false matches | Very high | Model inference/training | WebLogo-2M is academic-only/noisy; asset copyrights persist | Do not pursue now. Reconsider only with a clean, owned label corpus and defined classifier task |
| Blind CDN/path dictionaries | Icon/wide +0–1 pp | High: stale/default/guessable unrelated files | Medium network abuse risk | Many 404s and cache misses | Can violate crawl expectations | Reject. Probe only paths directly indicated by HTML, CSS, manifest, sitemap, or an explicit standard convention |
| Social-network profile scraping | Icon +0–2 pp | High identity/account risk | High and fragile | Login/rate-limit/anti-bot burden | Platform terms and avatar rights | Reject as a core source; use official APIs only after explicit sameAs and product/legal approval |

## 5. Prioritized coverage roadmap

### 5.1 Quick wins

These changes should be small enough to evaluate independently and do not require broad crawling.

1. **Make identity safety a gate.** Parse registrable domains, quarantine unexpected final redirects, expand parking/repurposing evidence, and preserve an unresolved state. Replay every known wrong-brand case before any recall work ships.
2. **Preserve all provenance and reserve per-role budgets.** Accumulate observations across URL/byte deduplication and prevent icon candidates from crowding out wide candidates.
3. **Split identity, role, and theme usability in labels and scoring.** Add light/dark usability, non-transparent content bounds, and explicit selection reasons.
4. **Extract tightly scoped CSS.** Begin with inline styles and already-downloaded same-origin stylesheets affecting header/nav/home-linked logo elements. Support `url()`, `image-set()`, `mask-image`, and `::before`/`::after`; do not admit arbitrary page backgrounds.
5. **Add cheap documented icon conventions.** Probe `/apple-touch-icon.png` only when no equivalent declared icon exists, and parse linked `browserconfig.xml`. Treat generic/default icons conservatively.
6. **Separate high-intent secondary pages.** Brand/press/media/newsroom links may enter the missing-wide queue; generic about/company links should not.

Hypothesis for the quick-win bundle: icon +1–4 pp, wide +3–8 pp, with wrong-brand selected rate reduced by at least half. The gains overlap.

### 5.2 Medium investments

1. **Targeted press discovery.** Use explicit navigation links first, then a sitemap only for recognizable brand/press paths. Extract direct SVG/PNG anchors and asset filenames with strict first-party identity evidence.
2. **Async JS-only queue.** Run the browser after the static response for missing or low-confidence wide logos; write results to the cache for later requests. Add pseudo-element, mask, `currentSrc`, open-shadow-root, and same-origin-frame support behind separate flags.
3. **Theme-family output.** Pair light/dark assets using provenance, DOM position, filenames, and conservative visual similarity. Return theme-specific variants rather than forcing one winner.
4. **BIMI experiment.** Query only the current organizational domain's default selector initially. Validate the current draft's SVG profile, record self-asserted versus VMC/CMC evidence, and keep it icon-only until precision is demonstrated.
5. **Identity-linked public metadata.** Measure prevalence of Android/Apple associations, exact-domain Wikidata, and reciprocal GitHub links before fetching downstream artwork. Keep each source independently disableable.
6. **Durable crawl/cache layer.** Cache raw bounded responses and parsed observations with validators so ranking, family grouping, and OCR experiments can run offline on identical inputs.

Hypothesis after quick wins plus medium investments: icon +2–7 pp and wide +6–15 pp relative to the current all-500 baseline, before overlap correction and quality gating.

### 5.3 Experimental bets

- OCR as an identity/ranking feature, first in shadow mode;
- secure resolution of SVG sprites and conservative element screenshots;
- sandboxed press-archive/PDF extraction after a prevalence survey;
- Common Crawl as a stale-URL diagnostic or recovery hint requiring live corroboration;
- a hosted-search comparator with explicit cost/terms controls;
- a later generic “logo-like versus UI/photo” classifier trained only on owned, carefully labeled examples.

Do not pursue broad social scraping, blind asset dictionaries, or academic web-logo datasets for production. They create more identity, rights, and operational problems than the expected incremental coverage justifies.

## 6. Experiment matrix, success gates, and stop conditions

All experiments use deterministic feature flags and paired domain-level output against the frozen baseline. Discovery experiments need same-day paired crawls where feasible; ranking experiments should replay identical cached observations.

| ID | Ablation | Primary metric | Success gate | Stop/reject condition |
|---|---|---|---|---|
| S1 | Identity quarantine/PSL redirect policy | Wrong-brand selected domains; false quarantine | ≥50% reduction on development wrong-brand cases, no more than 2/100 false quarantines; holdout confirms direction | Any accepted off-domain wrong-brand regression, or >2% clearly valid sites quarantined without an override path |
| D1 | Multi-evidence records + role queues | Correct candidate recall per role | ≥2 additional correct usable candidates/100 or equal recall with fewer downloads; no identity regression | Candidate loss from dedupe or >10% request increase without unique wins |
| V1 | Content bounds and theme usability | Correct usable-on-light/dark coverage | ≥3 corrected theme/role decisions/100 and no top-1 precision loss | Systematic clipping/false blank detection >1% |
| C1 | Inline scoped CSS | Correct wide/icon candidate recall | ≥2 net correct usable wins/100, ≥90% precision among new candidates | Any new wrong-brand top selection or new-candidate precision <90% |
| C2 | Same-origin CSS + pseudo/mask/image-set | Correct wide recall | ≥3 development and ≥2 holdout unique correct wins; mean added requests ≤2/domain attempted | Decorative/UI candidates dominate, p95 static latency >4.5 s, or precision below 90% |
| I1 | Root touch icon + browserconfig | Correct icon recall | ≥2 correct unique wins across dev+holdout and no generic-template winner | More incorrect/generic than correct unique wins |
| P1 | Explicit brand/press links | Correct wide recall | ≥3 dev wins and ≥2 holdout wins, no wrong-brand additions | Precision <90%, or >3 extra requests per attempted domain |
| P2 | Sitemap-assisted press paths | Correct wide recall per added request | ≥2 holdout wins beyond P1 and ≤1 selected page/domain | Fewer than 3 total correct wins across 200 or robots/load cost is disproportionate |
| B1 | Async current browser | Cache-warmed correct wide coverage; unique wins | Reproduce ≥4/100 development wins and ≥2/100 holdout wins; synchronous response unchanged | Browser invoked for >20% after warmup without proportional wins, or any safety-budget breach |
| B2 | Browser pseudo/shadow/frame features | Incremental correct candidates over B1 | Each feature yields ≥2 correct unique wins across 200 at ≥90% precision | Disable feature independently if zero/one win or UI contamination |
| M1 | BIMI default selector | Correct icon recall and source precision | ≥90% correctness for self-asserted and ≥98% for certificate-backed candidates; at least 2 unique wins/200 | Draft/profile complexity or DNS/SVG failures outweigh wins; any cross-domain identity error |
| A1 | App association prevalence | Verified association rate; first-party icon availability | Continue only if ≥5% of missing-icon domains expose valid associations and ≥3 unique first-party wins/200 | Store scraping is required, association ambiguity is high, or terms prevent intended use |
| W1 | Wikidata exact domain | Correct external fallback coverage | ≥95% candidate identity precision and ≥2 unique wins/200 with complete file-license records | Any untracked file license or recurring stale/wrong entity mapping |
| O1 | OCR shadow score | Company-token agreement precision/recall | ≥95% precision on positive name corroboration and demonstrable ranking separation | Stylized/short/multilingual false matches affect >5% of reviewed candidates |
| X1 | Archive/PDF prevalence pilot | Domains with usable current kits | At least 5 unique current wide logos in dev+holdout before building full parser | Too few kits, excessive size, ambiguous variants, or rights metadata unavailable |
| X2 | Common Crawl shadow recovery | Live-corroborated unique candidates | ≥3 correct live-corroborated wins/200 and zero former-owner promotions | Any stale asset becomes selectable without live evidence, or cost/latency exceeds browser wins |

Global shipping gates:

- **Wrong-brand safety:** no new accepted wrong-brand selections in development or holdout. Any such selection blocks the source from default use.
- **Precision:** selected precision must not fall by more than one percentage point per role, and the 95% interval must not conceal a material regression. New external-source candidates should meet at least 95% identity precision before default enablement.
- **Net usefulness:** count correct usable gains minus correct-candidate losses, not raw availability. A source that adds five images and displaces four better logos has one net win.
- **Cost:** record attempted domains, requests, bytes, DNS queries, browser invocations, CPU, p50/p95, and cache hit rate. High-cost sources must produce more than isolated anecdotal wins.
- **Noise floor:** rerun live discovery at least twice for features near the threshold; a result smaller than normal network/run variance does not ship.

## 7. Updated benchmark and labeling strategy

### 7.1 Development cohort (100)

Rebuild reviews around candidates rather than selections:

- Review up to the top three distinct candidate families for both icon and wide roles, plus every candidate introduced by a new source.
- Record `identity = correct | wrong | ambiguous`, applicable roles, `usable_on_light`, `usable_on_dark`, quality defects, theme/variant relationship, stale/current evidence, and reviewer notes.
- Never infer that an unlabeled candidate is correct. A completeness check should fail scoring if a required label is missing.
- Add an explicit “no correct candidate discovered” label per role so candidate recall has a known denominator.
- Double-label every wrong/ambiguous case and a random 10% sample to monitor reviewer agreement.

Use development for heuristic thresholds and error analysis. Report both all-domain and reachable-domain denominators, but optimize all-domain correct usable coverage.

### 7.2 Frozen holdout (100)

Do not inspect holdout labels while tuning. After a feature bundle freezes:

- generate the same top-three candidate review set;
- review it once with the same rubric;
- adjudicate disagreements without changing thresholds;
- allow one accept/reject decision for the bundle, not repeated holdout-driven tuning.

If a source only wins on development, it does not ship.

### 7.3 All 500 companies

For final evaluation:

- label every selected icon and wide logo, not only exceptions;
- label every quarantined/off-domain result and every selection from BIMI, Wikidata, app metadata, archives, browser screenshots, or search indexes;
- review a stratified sample of runner-ups by source and score band;
- run a second review on every wrong/ambiguous identity and a random 10% calibration sample;
- publish coverage as correct identity, correct role, usable on light, usable on dark, and usable on either—not just “selected.”

At the current selection counts this means roughly 614 selected icon/wide judgments before additions, which is tractable with good montages and keyboard-first labels.

### 7.4 Tooling changes needed before experiments

The future benchmark tooling should:

- cache bounded raw HTML, manifests, relevant CSS, DNS/RDAP/BIMI records, response headers, redirect chains, and browser observations by content hash;
- separate **discovery recall** (a correct candidate exists) from **ranking accuracy** (the best candidate wins);
- show top candidates side by side on light/dark backgrounds with source/evidence, final domain, and page context;
- avoid unsafe raw SVG embedding by rendering sanitized/rasterized previews;
- compute source-level unique wins, losses, precision, and cost;
- compare asset families so a light/dark pair is not counted as duplicate coverage;
- preserve the original frozen company/cohort files and attach exact config/tool versions to every run.

Recommended headline metrics:

1. all-domain correct-and-usable icon coverage;
2. all-domain correct-and-usable wide coverage;
3. selected identity precision and wrong-brand domain rate;
4. candidate recall per role;
5. light/dark dual-usability or variant-pair coverage;
6. source-specific net unique wins;
7. requests, bytes, browser invocations, p50/p95, and cache hit rate.

Use paired domain changes, bootstrap confidence intervals, and McNemar-style discordant-pair reporting where sample sizes permit. Always list the changed domains so small numerical gains remain auditable.

## 8. Operational, security, and crawl-policy constraints

### 8.1 Crawl policy

Follow [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html) for robots handling in automated benchmark/refresh crawls. Use a truthful stable user agent with a contact URL, and ensure the configured user agent actually reaches every static and browser request. Apply per-registrable-domain concurrency, delays, `Retry-After`, exponential backoff, and circuit breakers. Do not bypass CAPTCHA, login, consent controls, bot challenges, or explicit blocks.

Bound the crawl graph: homepage, directly declared metadata/assets, at most a few explicit high-intent brand pages, and optional well-known records. Do not become a general site crawler.

### 8.2 SSRF and untrusted content

The [OWASP SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) supports allow/deny controls but DNS validation must also be bound to the connection:

- resolve and validate every hostname, including redirect targets and asset URLs;
- connect to the validated address or use an egress proxy/resolver that pins the decision;
- reject private, loopback, link-local, multicast, carrier-grade NAT, metadata, reserved, and unsupported-address ranges for IPv4 and IPv6;
- allow only HTTP(S) on approved ports and cap redirect depth;
- treat registrable-domain identity and network safety as separate checks;
- run browsers without user credentials, cookies, extensions, local-network access, service workers, downloads, popups, or persistent profiles.

### 8.3 Resource and parser limits

Enforce compressed and decompressed byte limits, pixel/decode limits, timeouts, redirect limits, request counts, and per-stage budgets. For archives, also limit file count, path depth, nesting, expansion ratio, and total uncompressed size; reject traversal and symlinks. The [OWASP file-upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) is applicable even though the files are crawler-fetched.

Sniff type independently of extension and `Content-Type`. Rasterize untrusted SVG through a secure-static, no-network renderer after rejecting scripts, event handlers, `foreignObject`, active/external references, doctypes/entities, and oversized/pathological content. Never inject fetched SVG markup into the benchmark UI.

### 8.4 Caching and refresh architecture

Use HTTP validators and freshness semantics from [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html) and conditional requests from [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html). Cache positive and negative results, collapse concurrent requests for the same normalized URL, and separate:

- response cache: URL, redirect chain, headers, validators, bounded body hash;
- observation cache: parser version, page/theme/viewport, extracted evidence;
- asset cache: content hash, safe metadata, render previews;
- selection cache: ranking/model/config version and identity state.

Revalidate selected first-party assets more often than low-ranked candidates. Archived or external assets should expire into “unresolved,” never silently remain current. Cache keys for browser observations must include theme, viewport, browser version, and discovery version.

### 8.5 Rights, privacy, and provenance

First-party publication is evidence of brand identity, not an open-source license. Preserve source URL, page URL, observation time, source type, and any external file-license information. Provide a takedown/refresh path and avoid implying endorsement. Do not bundle discovered logos into the repository or redistribute bulk third-party catalogs without a separate rights analysis.

Avoid collecting unrelated page text, personal data, analytics identifiers, or cookies. Raw response snapshots should be access-controlled, retention-limited, and used for extractor reproducibility rather than republishing site content.

## 9. Coverage hypotheses and interpretation

All ranges are percentage-point hypotheses against the current all-500 baseline, not forecasts or promises.

| Stage | Icon hypothesis | Wide hypothesis | Main uncertainty |
|---|---:|---:|---|
| Identity quarantine alone | 0 to -2 raw; higher correct precision | 0 to -2 raw; higher correct precision | How many current selections are false coverage outside the labeled cohort |
| Role budgets, evidence retention, content bounds | +0.5 to +2 | +1 to +4 | Candidates currently hidden below the global cutoff |
| Scoped CSS/theme discovery | +1 to +4 | +3 to +8 | Prevalence of CSS-only brand assets versus decoration |
| Targeted press pages | +0 to +1 | +1 to +4 | Long-tail companies may lack press kits |
| Async browser improvements | +0 to +2 | +2 to +6 | Measured dev wins may not generalize to holdout/all 500 |
| BIMI/app/Wikidata combined | +0.5 to +3 | +0 to +1 | Low long-tail adoption and overlap with existing icons |
| Experimental sources combined | +0 to +3 | +1 to +6 | High overlap, precision gating, and prevalence |
| Practical quick + medium bundle | **+2 to +7** | **+6 to +15** | Non-additivity and correct-usability labels |

An icon increase from 73.0% to roughly 75–80% and a wide increase from 49.8% to roughly 56–65% are reasonable experiment targets, provided identity precision and usable rendering hold. A lower availability number with the seven known wrong brands quarantined may be a better product result than a higher unsafe number.

## 10. Smallest useful next implementation slice

The first implementation slice should be **identity-safe, role-aware evidence retention**, not a new external source.

It should contain only:

1. a registrable-domain helper backed by a maintained PSL implementation;
2. quarantine of unexpected final-domain redirects and known parking/mismatch cases;
3. candidate deduplication that merges all observations instead of choosing one provenance record;
4. separate bounded icon, wide, and favicon validation queues;
5. reviewer schema/tool changes that require explicit labels for identity, role, light usability, and dark usability;
6. a paired replay on the development cohort, followed once by the frozen holdout if the development safety gate passes.

This slice addresses the most important failure mode, makes later discovery sources measurable, and can rescue currently crowded-out wide candidates without adding crawl breadth. It deliberately excludes CSS parsing, BIMI, browsers, OCR, archives, and external datasets. Those become much safer to evaluate after identity, provenance, and labeling are trustworthy.

Definition of done for the slice:

- all seven known wrong-brand development cases are rejected or quarantined;
- no more than two clearly valid development domains are falsely quarantined;
- candidate observations survive URL and byte deduplication and are visible in review artifacts;
- correct candidate recall and top-1 accuracy are separately reported;
- no unlabeled selected candidate is silently treated as correct;
- request/byte budgets do not grow by more than 10% unless there are audited unique wins;
- holdout results are produced once, after thresholds freeze, with all changed domains listed.

Only after this slice passes should scoped CSS/theme extraction be implemented as the next coverage feature.
