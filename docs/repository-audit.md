# Repository audit

Audit date: 2026-08-24

This audit covers repository organization, module boundaries, reuse, and documentation. It intentionally does not propose a framework rewrite or a large abstraction layer.

## Baseline

- Runtime: Node.js 22+, ECMAScript modules, a dependency-light HTTP server, and a vanilla HTML/CSS/JavaScript frontend.
- Product code at the start of the audit: 13 modules in `src/`; the main extraction path is `src/extractor.mjs`.
- Offline tooling: 28 files in `scripts/`, covering benchmarks, captures, labeling, review generation, migrations, and experiments.
- Tests: 20 Node test files in `test/`.
- Tracked repository size: approximately 35 MB. Most of the weight is design imagery in `docs/design/` and `design/mockups/`.
- Generated run directories such as `runs/` and Playwright output are already ignored.

The frontend is small and appropriately uses vanilla JavaScript. Introducing React or a component framework would add more structure than this project needs.

## Prioritized findings

### 1. Separate shipped code from offline benchmark code

Before cleanup, benchmark-only capture and eligibility modules lived in `src/`, while reusable label logic lived beside executable scripts. They now live together under `benchmark/lib/`, and commands are grouped by purpose under `scripts/`.

The retained boundary is: production extraction and demo code in `src/`, reusable benchmark code in `benchmark/lib/`, and executable commands in categorized `scripts/` subdirectories.

### 2. Reduce the responsibilities of `src/extractor.mjs`

`src/extractor.mjs` currently owns safe URL handling, bounded HTTP reads, image validation, discovery budgeting, deduplication, fallback providers, orchestration, and response construction. Preserve `extractLogos()` as the public facade, but extract a few cohesive modules for networking, image validation, and candidate selection.

Do not split every helper into its own file.

### 3. Consolidate repeated primitives

The following logic appears in multiple places:

- private-IP and public-URL checks;
- bounded concurrency;
- data URL decoding;
- JSONL reading and atomic writing;
- canonical JSON and SHA-256 helpers;
- confined-path validation;
- benchmark CLI parsing;
- role, theme, favicon-source, and schema constants.

Create small, purpose-specific modules rather than a generic `utils` module. Runtime network safety and benchmark filesystem helpers should remain separate.

### 4. Share the demo extraction workflow (addressed)

The audit found that `src/server.mjs` and `api/extract.mjs` repeated request validation, rate limiting, extraction options, error mapping, and response headers. `src/demo/extraction-service.mjs` now owns that platform-neutral workflow, leaving thin local-Node and Vercel adapters.

### 5. Turn benchmark scripts into commands over libraries

Several scripts are hundreds of lines long and are imported directly by tests. That means they already serve as both libraries and command-line programs. Move reusable logic into `benchmark/lib/`; command files should parse arguments, invoke one operation, and report the result.

### 6. Clarify benchmark data ownership

Canonical benchmark material is currently divided among `benchmarks/`, `fixtures/`, `schemas/`, and `labels/`, while selected output is divided between `reports/` and `reviews/`. Consolidate these under a documented benchmark data root in a later code-moving change. Continue to keep generated `runs/` ignored.

### 7. Merge the two design roots

`design/mockups/` and `docs/design/` both contain design exploration. Keep deployed assets in `public/assets/` and consolidate non-shipping design source and mockups under `docs/design/`. Superseded large variants can be archived or removed after confirming they are no longer useful.

### 8. Replace broad `internals` exports over time

Tests import broad `internals` objects from production modules, including a compatibility contract in `src/extractor.mjs`. Once cohesive modules exist, tests should import the relevant functions directly. Keep a temporary facade during migration so the reorganization remains behavior-preserving.

### 9. Standardize names at explicit boundaries

The code mixes `normalise`/`normalize`, camelCase/snake_case, and `resolvedUrl`/`resolved_url`. Use camelCase inside JavaScript modules and convert to persisted benchmark or API field names only at serialization boundaries.

### 10. Keep the frontend simple

`public/app.js` is already divided into small rendering helpers, and the game correctly separates `game-core.js` from `game-ui.js`. Reuse a markup helper only where repetition is real; do not introduce a component framework for this codebase.

## Suggested sequence

1. Record passing tests and preserve the current `extractLogos()` and HTTP response contracts.
2. Consolidate shared network-safety and benchmark-IO primitives.
3. Share the local/serverless demo extraction workflow.
4. Split `src/extractor.mjs` behind its existing facade.
5. Separate benchmark libraries, commands, and data.
6. Consolidate documentation and design artifacts.
7. Remove compatibility exports and retire one-off scripts only after reference checks.

Each step should be independently testable and should avoid mixing file moves with behavioral changes where practical.
