# Logo Yoink

Give Logo Yoink a company website and it finds, validates, and ranks the logo assets the site exposes.

It currently checks:

- Schema.org `Organization`, `Corporation`, `Business`, and `Brand` logos
- visible header/navigation images, lazy-loaded images, `picture` sources, and safe inline SVGs
- `og:logo`, microdata logo fields, and linked image metadata
- Web-app manifest icons
- Apple touch icons, mask icons, Microsoft tiles, and HTML favicon links
- Root `/favicon.ico` and `/favicon.png`
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

Set `BESTICON_URL` for the CLI in the same way as the web service.

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

- Many websites block automated clients; the optional browser fallback costs substantially more than static extraction.
- A website can expose a product icon rather than its legal-company logo.
- SVG and raster dimensions do not prove visual quality; padded wordmarks can still look poor in a square UI.
- Redirected or rebranded domains may expose a logo that no longer matches the database company name.

The tool returns multiple ranked candidates because automatic extraction cannot eliminate all of this ambiguity.
