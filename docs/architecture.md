# Architecture

Logo Yoink has two systems in one repository:

1. a small shipped product that discovers, validates, and ranks website logos;
2. an offline benchmark and review workflow used to measure and improve that product.

Those systems may share the public extraction API, but production code must not depend on benchmark code.

## Product path

```text
CLI / local server / Vercel function
                 |
             extractLogos
                 |
      discovery -> validation -> ranking
                 |
       selected roles and candidates
```

### Entrypoints

- `src/cli.mjs` provides the command-line interface.
- `src/server.mjs` serves the local site and HTTP API.
- `api/extract.mjs` adapts the extraction API to Vercel.
- `public/` contains the deployed static frontend and game.

Entrypoints should contain configuration and platform adaptation, not extraction rules.

### Extraction

- `src/extractor.mjs` orchestrates the pipeline and exposes `extractLogos()`.
- `src/discover-static.mjs` parses HTML and metadata without a browser.
- `src/discover-browser.mjs` performs the bounded rendered-page fallback.
- `src/discover-deep.mjs` inspects bounded first-party brand pages, archives, and optional SPA assets.
- `src/discover-bimi.mjs` owns opt-in BIMI TXT assertion parsing, bounded DNS caching, and conservative active/external SVG safety checks. Full BIMI SVG profile conformance is not claimed.
- `src/asset-model.mjs` owns canonical asset preferences and variant descriptions.
- `src/rank.mjs` scores candidates and selects the canonical icon and wordmark assets. Favicon remains an API compatibility alias for icon.
- `src/tiny-image-suitability.mjs` measures tiny-render suitability.
- `src/network-safety.mjs` owns canonical host and private-address classification.
- `src/http-client.mjs` owns public-URL validation, redirect revalidation, timeouts, and bounded response reads.
- `src/concurrency.mjs` provides the small ordered concurrency primitive shared by extraction and offline commands.

The desired dependency direction is orchestration -> discovery/validation/ranking. Discovery modules should produce candidates and evidence; they should not choose final winners.

### Demo boundary

- `src/demo/extraction-service.mjs` owns the shared request-to-extraction workflow and transport-neutral result shape.
- `src/demo/security.mjs` owns request validation, demo limits, same-origin checks, concurrency, and security headers.
- `src/demo/serverless-browser.mjs` owns serverless Chromium launch configuration.

Local and serverless HTTP adapters call the same platform-neutral demo extraction service. Platform-specific response objects and browser launch details remain in the adapters.

### Frontend boundary

- `public/app.js` owns the logo finder interaction and result rendering.
- `public/game-core.js` owns deterministic game state and rules.
- `public/game-ui.js` owns browser input, drawing, sound, and persistence.

Keep this frontend framework-free unless its scope grows substantially. Game rules must remain testable without the DOM.

## Offline benchmark path

The benchmark implementation is split between reusable modules in `benchmark/lib/`, categorized commands in `scripts/`, and versioned data directories. Its dependency boundary is:

```text
benchmark commands -> benchmark libraries -> public extraction API
                              |
                    canonical benchmark data
```

Benchmark code may import `extractLogos()` and ranking helpers. Product code must never import capture, labeling, review, or benchmark-report modules.

Generated run output belongs in ignored `runs/`. Only frozen inputs, schemas, adjudicated labels, and intentionally selected reports should be committed.

## Module rules

- Prefer a cohesive named module over a general `utils` collection.
- Keep network-safety validation in one production module.
- Keep benchmark JSONL, hashing, atomic-write, and safe-path helpers in benchmark-owned modules.
- Keep persisted snake_case schemas at IO boundaries; use camelCase internally.
- Preserve `extractLogos()` as the stable programmatic entrypoint while internals are reorganized.
- Avoid barrel files; direct imports make this small dependency graph easier to follow.
