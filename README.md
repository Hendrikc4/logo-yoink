<p align="center">
  <a href="https://logo-yoink.com"><img src="public/favicon-32.png" width="96" height="96" alt="Logo Yoink favicon"></a>
</p>

<h1 align="center">Logo Yoink</h1>

<p align="center">
  <strong>Find company icons and wordmarks from a URL.</strong>
</p>

<p align="center">
  <a href="https://logo-yoink.com/">Try the live demo</a>
  ·
  <a href="https://logo-yoink.com/docs">Read the docs</a>
  ·
  <a href="#quick-draw">Run it yourself</a>
  ·
  <a href="#use-the-api">Use the API</a>
  ·
  <a href="#how-it-works">How it works</a>
</p>

<p align="center">
  <img alt="Node.js 22+" src="https://img.shields.io/badge/Node.js-22%2B-3c873a?style=flat-square">
  <img alt="MIT licensed" src="https://img.shields.io/badge/license-MIT-f0a23b?style=flat-square">
  <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-yes-31a8ff?style=flat-square">
</p>

<p align="center">
  <img src="public/assets/how-it-works/logo-yoink-twilight-trail.webp" alt="Pixel-art cowboy on horseback lassoing icon and wordmark tiles from a browser portal in a twilight desert">
</p>

Free, open source, and self-hostable. No account or API key required. Give Logo Yoink one URL and it finds the real image files a site exposes, checks that they work, removes duplicates, and ranks the best choices for:

- **Icon** — apps, avatars, square UI, and favicons
- **Wordmark** — headers, cards, and wider layouts

You get the candidates, their evidence, and downloadable files. No mystery black box. No invented logos.

## Quick draw

### Prerequisite

- [Node.js 22+](https://nodejs.org/) with npm

That is it. Logo Yoink does not need a database, account, or API key. Chromium is installed automatically because bounded browser rendering is part of the default quality path; Jina remains off.

### Install the JavaScript API

Install straight from GitHub (the commands below do not require an npm publication):

```bash
npm install github:Hendrikc4/logo-yoink
```

```js
import { yoink } from 'logo-yoink';

const { icon, logo } = await yoink('stripe.com');
console.log(icon?.resolvedUrl, logo?.resolvedUrl);
```

The install also downloads Chromium. No separate setup step or environment file is required.

### Clone and run the API server

```bash
git clone https://github.com/Hendrikc4/logo-yoink.git
cd logo-yoink
npm run setup
npm start
```

Open **http://127.0.0.1:4310**, paste a website, and hit **Yoink it**.

For automatic restarts while editing the API or web app, use `npm run dev` instead of `npm start`. Both commands serve the UI and `/api/extract` from the same local address.

`npm run setup` installs the Node dependencies and Chromium. On a fresh Linux machine, use `npm run setup:linux` so Playwright also installs Chromium's system libraries. If you deliberately want static-only extraction, use `npm run setup:static`; it skips the browser download.

The checked-in `.env.example` documents every server setting. Copy it to `.env.local` only when you want to change a default or add a key. `.env.local` is gitignored; do not put API keys in tracked files.

### Verify the setup

After installation, check the UI and local API without contacting a third-party site (the main server does not need to be running):

```bash
npm run smoke
```

Then verify a real extraction through either the CLI or the running web app:

```bash
npm run cli -- logo-yoink.com
```

The smoke check starts an isolated local server on an available port, verifies the homepage and API request validation, and shuts it down. `npm run check` runs syntax checks, the complete test suite, fixture validation, and this smoke check.

> There is also an optional cowboy runner below the finder. Jump the cacti, collect logos, and grab a lasso to auto-yoink the next three. Space, Arrow Up, W, and taps all work. 🤠

## Use the CLI

After cloning and running setup as shown above, see the ranked results as JSON:

```bash
npm run cli -- stripe.com
npm run cli -- stripe.com --no-wikimedia-fallback
```

The Wikidata/Wikimedia Commons missing-role fallback is enabled by default. It
requires exact registrable-domain agreement with an active Wikidata official
website statement before validating a current Commons logo through the normal
network/image/SVG safety pipeline. It may abstain, and Commons license metadata
does not waive trademark restrictions.
Use `--no-wikimedia-fallback` in the CLI, `{ wikimediaFallback: false }` with
`extractLogos`, or `"wikimediaFallback": false` in an API request to opt out.

When the website has no trustworthy icon, an optional LinkedIn company-page
fallback can be enabled with `--linkedin-fallback`. Logo Yoink follows only a
canonical company link exposed by the first-party homepage (or an explicit
`--linkedin-company-url https://www.linkedin.com/company/...`), verifies the
identity evidence, and reports the source as `linkedin`. Access failures and
identity mismatches simply abstain.

Prefer a white/light logo for a dark surface and a transparent file:

```bash
npm run cli -- stripe.com --theme dark --background transparent
npm run cli -- stripe.com --theme dark --background transparent --strict
```

Or download the top pick:

```bash
npm run cli -- stripe.com --download ./downloads/stripe
```

Raster selections can also be enhanced during download. Model background removal
is optional, disabled by default, and available only in local installs. Set it up
explicitly once:

```bash
npx logo-yoink setup-background-removal
```

Setup installs the pinned CPU inference runtime and downloads verified model
weights into a user-local cache. Normal package installation does neither.
The selected model is BiRefNet Lite 512 FP32 (about 183 MiB of weights), using
aspect-preserving padding, two overlapping views for wide/tall logos, a soft mask,
and local edge matting to reduce halos. Uniform canvases also use model-guided
background connectivity to retain thin strokes and detached dots. Model operations run sequentially.
No GPU or Python installation is required.
On an Apple M1 Pro, testing measured about 2.7 GiB peak inference-process memory
and 2.3 seconds per image on average for the earlier single-attempt preset. Allow roughly 3 GB of memory headroom;
performance and peak memory vary by platform. Compared with the previous 1024
preset, the matched benchmark used 68% less peak memory and ran 3.8× faster.
Inference runs in a separate local process, reused during a batch and shut down
after five idle seconds so the OS can reclaim its native memory.
Existing users of the 1024 model must rerun `logo-yoink setup-background-removal`
to install the new pinned weights. Inference never silently downloads an upgrade.
The current preset tolerates minor edge speckles while checking for lost details,
filled counters and substantial halos. It produced transparent outputs for 21 of
42 regression inputs and 14 of 18 additional inputs. One badge output removes a
potentially intentional colored panel, so that result needs a brand-intent review.
A difficult image can receive one padded retry using the same model. The full
60-image run averaged 3.7 seconds per input including retries; this is a quality
tradeoff, not a speed improvement over a single attempt.
See the [resource and quality comparison](docs/background-removal-performance.md).
The [current pipeline review](docs/background-removal-pipeline-v2.md) records
coverage, remaining failures, visual QA and the historical baseline.
Subsequent background removal runs entirely on your machine without network
access; fetching the original website and logos still requires a connection.
The cache defaults to `~/.cache/logo-yoink/background-removal`. Set
`LOGO_YOINK_MODEL_CACHE` for both setup and extraction to use another directory.

Enable it per extraction:

```bash
npm run cli -- stripe.com --remove-background --width 1024 --download ./downloads/stripe
npm run cli -- stripe.com --upscale 2
```

Background removal first reuses an already-discovered transparent variant when
its asset family, role, theme, color and proportions match. That path needs no
model setup or inference. Otherwise it uses the local segmentation model.
Repeated image bytes within one extraction share the model result.
Missing setup or failed/unsafe processing preserves the original and
reports the reason in `processedAssets`. SVGs and already-transparent images
are left unchanged. Removal runs before optional upscaling.

For JavaScript use `{ removeBackground: true }`; the local HTTP API accepts
`"removeBackground": true`. The hosted API does not offer model background
removal, and the website has no background-removal control.

Upscaling uses bounded Lanczos resampling only when the raster is
smaller than the requested dimensions. Selected SVGs remain unchanged; a matching
transparent SVG alternative may supply a derived PNG for an opaque raster selection. The JSON keeps
the canonical originals in `assets` and returns originals, enhanced PNGs, and
transformation metadata together in `processedAssets`; upscaled results are
explicitly flagged as resampled because interpolation cannot restore missing detail.

Background removal can still struggle with small lettering, low contrast, or
artwork whose background is part of the brand. Keep the original and review
enhanced results before use. See the [model quality report](docs/background-removal-quality.md)
for measured comparisons and limitations.

Add `--role logo` to download the preferred wordmark instead of the default icon-first pick.

The CLI first checks the packaged, reviewed exact-domain brand library. Add `--live` to bypass it. On a library hit, live discovery runs only for a requested role or variant the approval does not cover. The CLI uses the bounded local browser for that fallback by default. Add `--no-browser` for static-only extraction, `--jina` to opt into Jina, or `--all-fallbacks` to enable Jina plus the deeper first-party passes. Jina requires `JINA_API_KEY`.

## Use the API

### From JavaScript

```js
import { yoink } from 'logo-yoink';

const result = await yoink('stripe.com');
result.icon; // best compact mark, or null
result.logo; // best wordmark, or null
```

`yoink` checks reviewed artwork for an exact canonical domain or explicit verified alias before contacting the site. It never widens a match to an arbitrary subdomain, parent, or subsidiary. Use `{ library: false }` (or call the low-level `extractLogos` export) to force live discovery. Use `roles: ['icon']` or `roles: ['logo']` when only one canonical role is needed.

Browser rendering is enabled by default. To force the fastest static-only path:

```js
const result = await yoink('stripe.com', { scrapers: [] });
```

To try Jina Reader when a site blocks direct requests, opt in and supply a key. Jina may get through common bot protection, but no scraper can guarantee access to every site.

```js
const result = await yoink('stripe.com', {
  scrapers: ['jina'],
  jinaApiKey: process.env.JINA_API_KEY,
});
```

Optional fallback and post-processing settings are available from JavaScript too:

```js
const result = await yoink('example.com', {
  linkedinFallback: true,
  removeBackground: true,
  upscale: { width: 1024, height: 1024 }, // or upscale: 2
});

result.assets.icon;                    // unchanged original
result.processedAssets.icon.original;  // same original
result.processedAssets.icon.enhanced;  // enhanced PNG, or null when safely skipped
```

You can enable both with `scrapers: ['browser', 'jina']`. Static discovery always runs first; scraper fallbacks run only when useful roles are still missing. The lower-level `extractLogos` export remains available for advanced budgets, test doubles, and discovery controls.

### Over HTTP

Once the local server is running:

```bash
curl -sS http://127.0.0.1:4310/api/extract \
  -H 'content-type: application/json' \
  -d '{"website":"stripe.com","preferences":{"icon":{"color":"white"},"logo":{"theme":"dark","background":"transparent"}}}'
```

HTTP requests may likewise include `"roles": ["icon"]`, `"linkedinFallback": true`,
`"removeBackground": true`, and `"upscale": {"width": 1024, "height": 1024}`.

The server uses its local browser by default. Send `"scrapers": []` for static-only extraction, `"scrapers": ["browser"]` for local browser rendering, `"scrapers": ["jina"]` for Jina, or both names together. Jina must be configured by the server owner with `JINA_API_KEY` and `PUBLIC_DEMO_ALLOW_JINA=1`; clients never send that secret.

The demo and API use the same default-on Wikidata/Commons fallback. Add
`"wikimediaFallback": false` to disable that external identity source. Scraper
selection is independent; use `"scrapers": []` when the whole request must stay
on the built-in direct-fetch path.

Both `preferences.icon` and `preferences.logo` accept the same optional fields. `theme` accepts `any`, `light`, or `dark` and describes the surface the asset must work on, so `dark` prefers light artwork. `color` accepts `any`, `color`, `white`, or `black`. `background` accepts `any`, `transparent`, or `opaque`. `representation` accepts a value (or array) such as `wordmark`, `compact_wordmark`, or `stacked_lockup`. Preferences are best-effort by default: a matching eligible asset wins when available, otherwise ranking falls back to the best eligible asset. Set `strict: true` on either role (or use CLI `--strict` for the selected role) to require exact known color and background values, plus sufficient measured contrast on the requested surface. Opaque artwork uses its own foreground/background contrast. The role is `null` when no candidate qualifies. `preferenceMatch` reports `exact`, `fallback`, or `unmatched` for each canonical role.

The response keeps canonical `assets.icon` and `assets.logo` selections and adds ordered `assetVariants.icon` and `assetVariants.logo` arrays. The selected asset is first. Additional entries must represent a distinct theme/color/background combination and clear `variantPolicy.minimumRoleScore` (currently 45, the medium-certainty boundary); delivery-size copies of the same artwork are not promoted as semantic variants. Every variant includes explicit metadata such as `{"theme":"dark","color":"white","background":"transparent"}` plus role-specific `certainty: { score, band }`.

For transparent artwork, strongly different measured contrast on light and dark
surfaces informs the theme metadata. This changes selection, not the source colors.
Compact, ambiguous marks and explicitly stacked logos are not accepted as full
wordmarks merely because their canvas is wide; `wordmark_caution` explains these
cases. Short wordmarks explicitly labelled as such remain eligible.

When a branded home link displays a logo inside a CSS sprite, a supported,
pixel-aligned viewport can produce a native-resolution PNG crop. Such assets are
explicitly marked `derived: true`, keep the complete source file and source URL in
`original`, and record crop coordinates in `transformations`. Their `resolvedUrl`
is the derived data URL. Unsupported positions, scaling, and ambiguous crops
abstain; no pixels or lettering are invented.

Grouped `assetFamilies`, every ranked `candidate`, normalized `preferences`, and discovery `diagnostics` remain available. `diagnostics.scrapers` reports which scraper choices were enabled and which actually ran. The homepage uses the canonical variant arrays for its inline icon and wordmark selectors. “More assets” contains only other high-confidence families and excludes every family already represented by a selected-role variant.

The simplest response fields are top-level `icon` and `logo`. They are aliases of `assets.icon` and `assets.logo`. `selectedByRole.logo` reports the canonical logo. For compatibility, `selectedByRole.icon` and `selectedByRole.wide` remain available, but `wide` is `null` for representations explicitly marked `stacked_lockup` or `compact_wordmark`. The deprecated `selectedByRole.favicon` key independently reports the best favicon-sized legacy selection; it never changes canonical `assets.icon` or `assets.logo`. When no true icon qualifies, a valid favicon-role candidate may become the canonical icon fallback.

### Defaults at a glance

| Capability | JavaScript / CLI default | HTTP server default | How to choose |
| --- | --- | --- | --- |
| Static first-party discovery | On | On | Always on |
| First-party brand-page recovery | On in `yoink`; off in CLI | On | `deep: false` in JavaScript or omit `--deep-wide` in CLI |
| Cached favicon recovery | On | On | `cachedFavicon: false` in JavaScript |
| Exact-domain Wikimedia recovery | On | On | `wikimedia: false`, `--no-wikimedia-fallback`, or `"wikimediaFallback": false` |
| Local Playwright browser | **On** | **On** | Use `scrapers: []`, `--no-browser`, or HTTP `"scrapers": []` to disable it |
| Jina Reader | **Off** | **Off** | Add `"jina"` to `scrapers` and configure `JINA_API_KEY` |
| Experimental BIMI | Off | Off | `bimi: true`, `--bimi`, or `PUBLIC_DEMO_BIMI=1` |
| Experimental robots/sitemap recovery | Off | Off | `sitemap: true` in JavaScript |

## How it works

<p align="center">
  <img src="public/assets/how-it-works/ai-ranking-trail.webp" alt="Pixel-art cowboy lassoing icon and wordmark tiles from a browser window">
</p>

Logo Yoink uses deterministic discovery and ranking. AI helped build the benchmark
used to improve it. Extraction does not call an AI service; local installs can
explicitly enable a local model for optional background removal after selection.

1. **Discover broadly.** The static pass reads the page, structured data, manifests, favicon declarations, image sources, and safe inline SVGs. A bounded browser pass can recover assets rendered by JavaScript.
2. **Validate and deduplicate.** Candidates are downloaded under strict budgets, checked as real image bytes, measured, and collapsed by URL, content hash, and asset family.
3. **Rank for the job.** Each candidate gets icon and wordmark selections from its source, shape, resolution, page placement, home-link evidence, company-name agreement, variant fit, and negative context. The API returns the winners plus the evidence behind every score.

### How the ranking was optimized

The benchmark freezes **500 company websites** and the candidates found on them. AI reviewers inspected numbered contact sheets and produced **2,277 adjudicated candidate labels** covering identity, role, best-in-role, and usability on light and dark backgrounds. Deterministic validators mapped those judgments back to stable candidate IDs; scores and URLs were hidden from the labeling view to reduce bias.

Those labels turned “looks right” into measurable targets: identity precision, role precision, discovery recall, conditional rank recall, end-to-end recall, best-hit rate, and wrong-brand count. Ranking and discovery ideas were then tested as isolated experiments on development data, checked on validation, and rejected when extra coverage cost too much precision. The result is a deliberately simple, interpretable rule set optimized to recover as many usable logos as possible without quietly promoting partner marks, UI icons, or stale brands.

On the frozen current-identity baseline, captured under ranking version 3, a correct icon or wordmark was selected for **327 of 385 sites (84.9%)**. When a correct wordmark was present in that frozen candidate set, the captured ranker selected one **93.3%** of the time. These historical frozen measurements do not qualify later runtime ranking or discovery changes; see [`docs/current-system-logo-optimization-plan.md`](docs/current-system-logo-optimization-plan.md) and the [`visual benchmark schema`](schemas/visual-benchmark-v1/README.md) for the full methodology.

## What gets yoinked?

<table>
  <tr>
    <td width="112" align="center"><img src="public/assets/ui/feature-lasso-browser.png" width="88" alt="Pixel-art lasso around a browser window"></td>
    <td><strong>The obvious stuff</strong><br>Visible header images, picture sources, safe inline SVGs, and lazy-loaded assets.</td>
  </tr>
  <tr>
    <td width="112" align="center"><img src="public/assets/ui/feature-sheriff-badge.png" width="88" alt="Pixel-art sheriff badge"></td>
    <td><strong>The hidden clues</strong><br>Schema.org data, metadata, manifests, touch icons, mask icons, tiles, and favicons.</td>
  </tr>
</table>

Every candidate is downloaded, byte-validated, deduplicated, and scored with role-specific rules. If the fast static pass misses an icon or wordmark, the web app can make a bounded Playwright pass for JavaScript-rendered assets.

<details>
<summary><strong>Need more horsepower?</strong></summary>

First-party homepage discovery still runs first. The bounded recovery stages only run for missing eligible roles.

| Need | How |
| --- | --- |
| Skip browser rendering | `BROWSER_DISCOVERY=0 npm start` |
| Allow request-level Jina recovery for blocked or unusable homepages | Add `JINA_API_KEY` and `PUBLIC_DEMO_ALLOW_JINA=1` to `.env.local`, then request `"scrapers":["jina"]` |
| Use a local [Besticon](https://github.com/mat/besticon) fallback | `BESTICON_URL=http://127.0.0.1:8080 npm start` |
| Disable exact-domain Wikidata/Commons recovery | Add `--no-wikimedia-fallback` or set `PUBLIC_DEMO_WIKIMEDIA=0` |
| Follow likely brand/press pages in the CLI | Add `--deep-wide` |
| Inspect one same-origin SPA bundle too | Add `--deep-wide --spa-bundles` |
| Try the measured BIMI icon fallback | Add `--bimi` (experimental, off by default) |

Logo Yoink automatically loads a gitignored `.env.local` file. Setting `JINA_API_KEY` does not enable Jina by itself. HTTP requests also require `PUBLIC_DEMO_ALLOW_JINA=1`.

The primary local settings are:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Local server bind address |
| `PORT` | `4310` | Local server port |
| `BROWSER_DISCOVERY` | `1` | Enable the Chromium fallback |
| `JINA_API_KEY` | unset | Makes request-level Jina recovery available; it does not enable Jina |
| `BESTICON_URL` | unset | Optional URL of a local Besticon service |
| `PUBLIC_DEMO_ALLOW_JINA` | `0` | Set to `1` to allow explicitly requested Jina calls after configuring a budget |
| `PUBLIC_DEMO_BROWSER` | `1` | Set to `0` to prevent web/API requests from using Chromium |
| `PUBLIC_DEMO_WIKIMEDIA` | `1` | Set to `0` to disable Wikidata/Commons missing-role recovery in the demo |
| `PUBLIC_DEMO_BIMI` | `0` | Set to `1` to enable the experimental BIMI fallback for web/API requests |

`--deep-wide` only runs when the homepage has no accepted wide logo. It attempts
at most two brand, press, or media pages and can inspect official ZIP kits. Strong
explicit links take priority; conventional `brand.<domain>` and `/brand` probes
fill gaps. It retains displayed page logos as well as download links. When
rendering is enabled, one discovered official page may be rendered after the
homepage still has no wordmark. Each browser page retains its time and declared
transfer limits, with a 300-request ceiling for sites using many small JavaScript
chunks and one short retry for an empty rendered observation.
`diagnostics.deep` and `diagnostics.browser.attempts` expose these recovery stages.
`--spa-bundles` scans at most one same-origin entry bundle, up to 2.2 MB, for a
company-logo asset literal.

An HTTP-denied homepage can still reach the enabled public browser, cached
favicon, and exact-domain Wikimedia recovery stages. A partial result retains
the failed `reachability` attempts and sets `diagnostics.homepageUnavailable`;
it does not claim that the homepage was accessed. If no eligible asset is
recovered, extraction still fails. These fallbacks require no new service or key.

`sitemap: true` enables a missing-wide-only recovery pass in the JavaScript API. It reads robots-declared sitemaps on the exact registrable domain, fetches at most one likely official page, and admits only wide-role candidates within separate request, byte, redirect, and wall-clock limits.

`--bimi` queries `default._bimi.<domain>` after the first-party recovery stages admitted by the pipeline's existing static/deep/browser gates and before the built-in Google or DuckDuckGo favicon fallbacks. Optional Besticon keeps its existing budgeted discovery position because the frozen BIMI runs did not enable or compare it. BIMI does not trigger a new browser crawl or Jina screenshot solely for a missing icon. It accepts one unambiguous `v=BIMI1` assertion with a nonempty HTTPS `l=` URL, then applies the normal public-address, redirect, timeout, byte, MIME, and conservative SVG-safety checks. Full BIMI SVG profile conformance is not claimed, so canonical icon admission additionally requires measured icon-shaped artwork. BIMI is restricted to icon/favicon-like roles and never supplies `assets.logo`. An `a=` evidence-document pointer is recorded but not certificate-validated, and no trademark or license permission is inferred. The option remains experimental because the frozen development/validation experiment found safe selections but no incremental correct selections over the existing cached-icon fallback.

</details>

<details>
<summary><strong>Developing and benchmarking</strong></summary>

Run the tests:

```bash
npm test
```

Run the same syntax and test checks used by CI:

```bash
npm run check
```

The browser-backed tests require Chromium. Install it with `npx playwright install chromium` (or `npx playwright install --with-deps chromium` on a fresh Linux machine).

The main trail map:

```text
src/discover-static.mjs   find candidates in HTML and metadata
src/discover-browser.mjs  render the bounded browser fallback
src/discover-deep.mjs     inspect official brand paths and kits
src/discover-sitemap.mjs  inspect bounded robots-declared official pages
src/rank.mjs              score icons and wordmarks, then apply logo preferences
src/extractor.mjs         validate, deduplicate, and orchestrate
src/http-client.mjs       enforce safe, bounded network reads
src/demo/                 share demo policy across local and Vercel adapters
src/server.mjs            serve the tiny local web app and API
src/cli.mjs               print results or download the winner
```

The repository includes frozen 100- and 500-company cohorts plus a separate expanded 800-company fixture for repeatable extraction experiments. The expanded fixture preserves the original 500 rows and adds a curated `major-brands-300` cohort spanning consumer, enterprise, healthcare, finance, media, infrastructure, and multiple geographies. Start a benchmark with:

```bash
npm run benchmark -- --cohort original-100 --output runs/my-run
npm run review-montage -- runs/my-run
```

The runner loads `fixtures/companies-500.json` for legacy cohorts and `fixtures/companies-800.json` for `major-brands-300` or `all-800`, so the frozen 500 is not mutated. Validate both deterministic fixtures with `npm run fixtures:validate` before starting any network capture.

See [`docs/`](docs/) for the benchmark methodology, experiment logs, and visual-labeling workflow.

</details>

<details>
<summary><strong>A few honest limits</strong></summary>

- Some websites block automated clients.
- A site may expose a product icon instead of its company logo.
- Dimensions cannot reveal every padded or awkward wordmark.
- Redirected and rebranded domains can serve stale identity assets.

That is why Logo Yoink returns multiple ranked candidates instead of pretending one guess is always perfect.

The server binds to localhost by default. Static requests pin a validated public DNS address to each HTTP/TLS connection and revalidate redirects. Browser discovery uses an isolated context behind a validating HTTP/CONNECT proxy, including redirects and initial popup requests. The proxy limits actual inbound wire bytes and connection lifetime; service workers and WebSockets are blocked. SVG candidates must pass a full-document XML and CSS policy before decoding or returning downloadable bytes.

The demo keeps small JSON-only requests, origin checks, local rate/concurrency limits, request coalescing and generic errors. On Vercel it additionally checks shared per-client and aggregate firewall counters before extraction, failing closed if either rule is absent or unavailable. Jina requires both `PUBLIC_DEMO_ALLOW_JINA=1` and a request opting in. Local single-instance installs need no distributed service.

**Before deploying these changes**, configure the firewall rules and hosting limits in [the deployment security guide](docs/deployment-security.md). Vercel counters are regional, the local two-extraction cap is per instance, and CPU/memory isolation remains a hosting responsibility. These repository changes do not activate firewall rules or deploy the updated application.

</details>

<p align="center">
  <img src="public/assets/game/cowboy-horse.png" width="260" alt="Pixel-art cowboy riding a horse">
</p>

<p align="center"><strong>Happy yoinkin’.</strong></p>

Released under the [MIT License](LICENSE).
