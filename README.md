# Logo Yoink

Give Logo Yoink a company website and it finds, validates, and ranks the logo assets the site exposes.

It currently checks:

- Schema.org `Organization`, `Corporation`, `Business`, and `Brand` logos
- Web-app manifest icons
- Apple touch icons
- HTML favicon links
- Root `/favicon.ico` and `/favicon.png`
- An optional self-hosted [Besticon](https://github.com/mat/besticon) service

Every candidate is downloaded and inspected. The ranking favors square, high-resolution assets while retaining rectangular wordmarks for review.

## Run the web tool

Requires Node.js 22 or newer. There are currently no npm dependencies.

```bash
npm start
```

Open <http://127.0.0.1:4310>, enter a website, and download any returned candidate.

To add a locally hosted Besticon fallback:

```bash
BESTICON_URL=http://127.0.0.1:8080 npm start
```

Logo Yoink deliberately binds to localhost by default. It fetches user-provided URLs and should not be exposed publicly without stronger network-level SSRF protection, rate limiting, and authentication.

## CLI

```bash
npm run cli -- stripe.com
npm run cli -- stripe.com --download ./downloads/stripe
```

Set `BESTICON_URL` for the CLI in the same way as the web service.

## Test

```bash
npm test
```

## Architecture

- `src/extractor.mjs` — reusable extraction, validation, metadata, and scoring logic
- `src/server.mjs` — small localhost HTTP/API server
- `src/cli.mjs` — JSON and download CLI
- `public/` — dependency-free browser interface
- `fixtures/companies-500.json` — 100 original benchmark companies plus 400 additional canonical database samples
- `scripts/export-company-fixture.mjs` — reproducible Supabase CLI fixture exporter
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

- Many websites block non-browser HTTP clients or render metadata only after JavaScript executes.
- A website can expose a product icon rather than its legal-company logo.
- SVG and raster dimensions do not prove visual quality; padded wordmarks can still look poor in a square UI.
- AVIF and WebP candidates without cheaply readable dimensions are retained but score conservatively.
- Redirected or rebranded domains may expose a logo that no longer matches the database company name.

The tool returns multiple ranked candidates because automatic extraction cannot eliminate all of this ambiguity.
