<p align="center">
  <img src="public/assets/brand/logo-yoink-mark-512.png" width="160" height="160" alt="Logo Yoink cowboy hat and lasso logo">
</p>

# Logo Yoink

Give Logo Yoink a company website and it finds, validates, and ranks the logo assets the site exposes.

It currently checks:

- Schema.org `Organization`, `Corporation`, `Business`, and `Brand` logos
- visible header/navigation images, lazy-loaded images, `picture` sources, and safe inline SVGs
- `og:logo`, microdata logo fields, and linked image metadata
- Web-app manifest icons
- Apple touch icons, mask icons, Microsoft tiles, and HTML favicon links
- Root `/favicon.ico` and `/favicon.png`
- Google and DuckDuckGo favicon caches as a last resort when origin-hosted icons cannot be downloaded
- An optional self-hosted [Besticon](https://github.com/mat/besticon) service
- optionally, a bounded Playwright pass for logo assets that appear only after rendering

Every candidate is downloaded, byte-validated, deduplicated, and ranked separately as an `icon`, `wide` logo, or `favicon`. The default path is static and homepage-only; expanded-page and browser discovery are explicit fallbacks.

## Run the web tool

Requires Node.js 22 or newer.

```bash
npm install
npm start
```

Open <http://127.0.0.1:4310>, enter a website, and download any returned candidate.

The homepage also includes a small Logo Yoink cowboy runner. Press Space, Arrow Up, or W—or tap the playfield—to jump, collect logos, and avoid cacti. A lasso power-up automatically yoinks the next three logos. The game is entirely client-side and leaves the extraction API unchanged.

The web tool conditionally renders JavaScript-driven sites when the static pass cannot find an icon or wide logo. Set `BROWSER_DISCOVERY=0` to disable this slower fallback.

Set `JINA_API_KEY` to enable Jina Reader recovery. When direct homepage retrieval fails, Logo Yoink requests rendered HTML; when no usable logo asset survives normal extraction, it can capture and trim a genuine graphic or explicitly logo-marked home element into a downloadable PNG. Ordinary text home links are never converted into invented logos. Normal successful extractions do not incur Jina usage. The web tool and CLI automatically load a gitignored `.env.local` file.

```bash
JINA_API_KEY=your_key npm start
```

To add a locally hosted Besticon fallback:

```bash
BESTICON_URL=http://127.0.0.1:8080 npm start
```

Logo Yoink deliberately binds to localhost by default. It resolves and rejects non-public targets and revalidates redirects, but a public deployment should additionally pin the validated IP at connection time and add rate limiting and authentication.

## CLI

```bash
npm run cli -- stripe.com
npm run cli -- stripe.com --download ./downloads/stripe
npm run cli -- anthropic.com --deep-wide
npm run cli -- pnptc.com --deep-wide --spa-bundles
```

Set `BESTICON_URL` and `JINA_API_KEY` for the CLI in the same way as the web service.

`--deep-wide` is an explicit, conditional fallback: only when the homepage path has no accepted wide logo, it follows at most two semantically strong first-party brand/press/media links and can selectively inspect official ZIP kits. `--spa-bundles` additionally scans at most one same-origin SPA entry bundle (2.2 MB maximum) for an expected-company logo literal. Neither flag changes the default homepage path, and the browser fallback remains the broader asynchronous option.

## Test

```bash
npm test
```

## Benchmark

Run the frozen 100-company development cohort:

```bash
npm run benchmark -- --cohort original-100 --output runs/my-run
npm run review-montage -- runs/my-run
```

Other frozen cohorts are `holdout-100`, `remaining-300`, and `all-500`. Use `--browser`, `--expanded-pages 2`, `--deep-wide`, or `--deep-wide --spa-bundles` for measured ablations; none is enabled by default. A labeled score can be recomputed without crawling again:

```bash
node scripts/benchmark.mjs score --run runs/my-run --labels path/to/review-labels.jsonl
```

The automated availability proxy is not a quality score. The 0–100 benchmark score is emitted only after every selected icon and wide logo has a role-specific reviewer label.

## Architecture

- `src/extractor.mjs` — reusable extraction, validation, metadata, and scoring logic
- `src/discover-static.mjs` — parsed-document candidate discovery
- `src/discover-browser.mjs` — bounded rendered-browser fallback
- `src/discover-deep.mjs` — opt-in official asset graph, safe ZIP selection, and SPA entry-bundle probe
- `src/rank.mjs` — interpretable role-specific scoring
- `src/server.mjs` — small localhost HTTP/API server
- `src/cli.mjs` — JSON and download CLI
- `public/` — dependency-free browser interface
- `fixtures/companies-500.json` — 100 original benchmark companies plus 400 additional canonical database samples
- `scripts/export-company-fixture.mjs` — reproducible Supabase CLI fixture exporter
- `scripts/benchmark.mjs` — frozen-cohort runs, comparisons, and labeled scoring
- `scripts/contact-sheet.mjs` and `scripts/review-montage.mjs` — visual QA artifacts
- `docs/logo-discovery-plan.md` — researched implementation and evaluation plan
- `docs/benchmark-2026-08-22.md` — results that informed the initial pipeline

## Test dataset

The repository includes 500 unique company name/website pairs for repeatable extraction experiments. The first 100 preserve the original benchmark cohort; the remaining 400 are deterministic additions from `canonical_v2.startup_directory_projection`.

Validate the fixture with:

```bash
npm run fixtures:validate
```

To regenerate it from a linked StartupSeeker Supabase project:

```bash
node scripts/export-company-fixture.mjs \
  --source-project /path/to/startupseeker_v2 \
  --original-sample /path/to/favicon-review-sample.json
```

## Current limitations

- Many websites block automated clients; the optional browser and Jina fallbacks cost substantially more than static extraction, and Jina respects sites that block its service.
- A website can expose a product icon rather than its legal-company logo.
- SVG and raster dimensions do not prove visual quality; padded wordmarks can still look poor in a square UI.
- Redirected or rebranded domains may expose a logo that no longer matches the database company name.

The tool returns multiple ranked candidates because automatic extraction cannot eliminate all of this ambiguity.
