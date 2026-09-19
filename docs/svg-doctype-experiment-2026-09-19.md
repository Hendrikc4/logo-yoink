# Static SVG declaration normalization experiment

The baseline rejects older editor exports containing any DOCTYPE, including the canonical SVG 1.1 declaration with no internal subset. Berkshire Hathaway was the first diagnosed case. The retained change removes that exact declaration only after checking the whole document against a narrow, self-contained static SVG subset. It never fetches a DTD, resolves custom entities, changes path geometry, or relaxes BIMI validation.

## Paired results

The experiment uses the frozen source snapshot at `runs/missing-logo-program-2026-09-19/baseline/src`, the existing approved library, and development-only captured asset responses. It makes no network requests. The initial run below used 28 development candidates available at the time and 979 unique currently approved library asset paths. It is an SVG ablation, not the whole missing-company benchmark or an independent holdout evaluation.

| Population | Inputs | Baseline validates | Normalization validates | Lost valid assets |
| --- | ---: | ---: | ---: | ---: |
| Approved library controls | 979 | 974 | 976 | 0 |
| Captured development candidates | 28 | 24 | 28 | 0 |
| Total | 1,007 | 998 | 1,004 | 0 |

Four missing-company candidates validate after normalization: Barrick Mining, Berkshire Hathaway, Lufthansa, and Traton. Under the unchanged baseline ranker, Barrick, Lufthansa, and Traton select for the wide role. Berkshire's extreme aspect ratio remains ineligible. Patagonia and Ray-Ban are existing approved assets whose ingestion compatibility improves; they are not missing-company gains. Three approved controls still fail the validator because their SVG files contain internal subsets/custom entities: Mastercard, Mitsubishi Heavy Industries, and Danaher. No approved files or manifests were changed.

All six newly normalized files render identically before and after removal at an 800 × 200 white-background comparison. The contact sheet was visually inspected: all are recognizable company wordmarks, with no clipped letters, photos, or broken renderings. Ray-Ban retains its intentional red box. Traton retains its GROUP subtitle. This checks image integrity; it does not establish rights to use a trademark.

The current [TRATON media center](https://traton.com/en/newsroom/media-center/mediacenterresults.html?filter=logo&from=0&size=12&sort=relevance&type=photos) supplies both TRATON and TRATON GROUP logo variants; its current homepage wordmark was also captured and visually compared. The [Lufthansa Group brand announcement](https://newsroom.lufthansagroup.com/en/lufthansa-group-launches-new-brand-identityapac/) distinguishes the December 2025 Group redesign from its airlines, which retain their own brands. The recovered Lufthansa asset is the airline mark associated with `lufthansa.com`, not the Group mark. Barrick and Berkshire retain the captured Wikidata current-logo/P856 identity evidence; direct fresh homepage requests were blocked for Barrick and Lufthansa. No library approval was performed by this experiment.

## Implementation and safety boundaries

- `normalizeLegacySvgDoctype` in `src/standalone-svg.mjs` accepts only the canonical W3C SVG 1.1 PUBLIC declaration, with no internal subset. Unknown/system declarations, custom entity dependencies, encoding errors, additional declarations, and stylesheet processing instructions abstain.
- A full-document static element allowlist excludes script, foreignObject, images, stylesheets, animation, and unknown elements. Parsed attributes restrict references to local fragment IDs; external or encoded links, CSS escapes/comments/imports, event handlers, and xml:base abstain. Inline styles have a presentation-property allowlist.
- The extractor invokes the helper only after initial metadata detection fails and never for BIMI. Normalized files still undergo metadata, renderability, and ordinary downstream checks. Provenance records `original_byte_hash` and `svg_normalization`; the output hash covers the actual normalized bytes.
- Six focused tests include network and byte validation, unchanged BIMI rejection, malicious DTDs, custom entities, encoded external href/CSS, active markup beyond 64 KiB, invalid encodings, and multiple roots.

## Reproduction

```sh
node scripts/experiments/svg-doctype-recall.mjs \
  --captured-rows runs/missing-logo-program-2026-09-19/baseline-all/rows \
  --output runs/missing-logo-program-2026-09-19/svg/captured-development
node --test test/standalone-svg.test.mjs test/extractor.test.mjs test/bimi.test.mjs
```

The experiment always excludes held-out capture rows. As capture inventory grows, reruns may include more development candidates; the exact input rows, source URLs, original/output hashes, validation outcomes, role outcomes, and source/manifest hashes are in its `results.json`. Optional `--candidate-inputs` accepts a JSON array of `{id, path, cohort, candidate}` records for additional explicitly selected local assets.

Initial artifacts are under ignored `runs/missing-logo-program-2026-09-19/svg/`: `captured-development/results.json`, `captured-development/review.png`, normalized SVGs, and `focused-tests.log`. The first diagnostic Berkshire download is `berkshire-original.svg`, SHA-256 `52868c93c01c2314613a62fce54c82c3b90f921e88175c36c86a7aa85b42b8b0`. Its normalized hash is `bab6f6c1e94a34fb88f0ccd301c050dddf0a5dacade4a7e397f6d1642ba8bc7d`.

Baseline extractor SHA-256: `03e8478c54ba033b6d490840508fa9598b024e1178c0b192fd3767bd88279950`.

Treatment helper SHA-256: `a6cdd027c35f3c234d35cf91f0dabeae0fc1b971d07335fbae60950dfc240209`.

Approved-library manifest SHA-256: `4fc29e2f8407c7d5c730e4166fa16d0c5984ed79e7e1e400aec76e9ab79a5a4e`.
