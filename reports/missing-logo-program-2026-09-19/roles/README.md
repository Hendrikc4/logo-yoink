# Role semantics and official-resource experiment

**Decision: drop canonical-filename role semantics; retain timeout recovery.** The development gain was 3M, but the heldout evaluation lost the visually correct TEPCO wordmark because its Commons filename says `TEPCO_symbol.svg`. The whole role-semantic change was reverted without tuning to the heldout example. Production ranking remains version 12.

These are development diagnostics, not approved library additions or frozen benchmark qualification. No heldout or frozen examples were used to tune this experiment. Inputs are the previously exposed 40-company Wikimedia cohorts plus five existing resolver controls.

| Development measurement | Baseline | Rejected role treatment |
|---|---:|---:|
| Commons discoveries in exposed missing 40 | 23 | 23 |
| Validated files, before separate SVG repair | 19 | 19 |
| Automatic canonical-role selections in missing 40 | 15 | 16 |
| Validated candidates including successful downloaded controls | 21 | 21 |
| Automatic selections including downloaded controls | 17 | 18 |
| Other validated candidates with changed selections | — | 0/20 |
| Extra candidates from bounded official/deep path, 8 dev companies | — | 0 |

The only development role-semantics gain was **3M**. Its verified canonical Commons filename is `3M wordmark.svg`, but the ranker ignored that field when checking the existing explicit-short-wordmark exception. The rejected ranker 13 experiment included only `commons_canonical_filename` from a `wikimedia-commons` candidate with `wikidata_identity_verified === true`. It did not consume arbitrary `semantic_text` or uncanonicalized names. Aspect-ratio limits, identity, image safety, score, role allowlists, clipping and theme checks are unchanged. Stacked and symbol filenames still withhold wide roles.

The downloaded red 3M mark was visually inspected on white; SHA256 `f1dc290891967c9e7e53d434406998daee2c31375575d0761534041d825adc05`. The company's [official gallery](https://news.3m.com/logos) supplies a 3M logo; its [official brand guidance](https://brand.3m.com/3M/en_US/brand/dealers-and-channel-partners/) corroborates red-logo use. This is identity/artwork evidence, not a trademark-use permission claim.

## Precision caveats

Automatic selection is not the same as usable, current artwork. Visual inspection of the 21 downloaded candidates found preexisting baseline issues: Nike's Swoosh was assigned a wide role despite being symbol-only; Pepsi's old roundel was identity-correct but outdated; McKinsey and Singapore Airlines use multiline lockups despite no filename `stacked` cue. These are unchanged baseline outputs, not newly admitted marks. Lowe's, Best Buy and Lyft remain unselected by the Commons role path; blindly lowering aspect thresholds would change the role contract. Berkshire remains too wide for the strict external-source aspect boundary after the separate SVG repair.

## Official-resource ablation

`scripts/experiments/official-missing-role-ablation.mjs` tested Lowe's, Best Buy, Lyft, 3M, GoPro, Carrefour, ABB and Bank of America with 4s resource timeouts, 16 static candidate downloads, at most two existing deep official pages, no browser, paid/Jina service or real Wikimedia lookup. Baseline was reranking the same capture without `deep_official` candidates; treatment included them. No extra validated deep candidates appeared. Three baseline outputs existed: GoPro's official favicon (visually reviewed blue camera-like mark), Bank of America's icon+wordmark (both visually reviewed), and Lyft's compact full wordmark misclassified as icon (not accepted as a true icon). Lowe's yielded no selected art. Best Buy, 3M and ABB timed out before deep discovery; Carrefour was 403-blocked. A second blocked-recovery check let Carrefour reach its existing bounded probes: brand subdomain did not resolve and `/brand` returned 403; no gain. Do not infer that larger crawl budgets would solve these misses.

## Timeout pipeline repair

This experiment exposed a distinct integration failure: pure homepage timeouts threw before independently verified Wikimedia recovery, while 403-blocked pages were allowed through. The extractor now permits the same downstream recovery when **every attempted homepage failure is a timeout**, Wikimedia fallback is enabled, and no page was acquired. Mixed DNS/TLS/redirect failures remain ineligible for this new exception. Default root-favicon and cached-favicon probes are skipped on this timeout-only path; explicitly enabled optional discovery paths retain their existing behavior. Failed recovery retains the original failure class and diagnostics. Jina status/errors receive the same failure classification as native acquisition; a mocked all-timeout Jina sequence recovers while mixed Jina TLS failures remain closed. Its existing URL-validator injection is forwarded consistently for offline tests; defaults retain public-URL validation. Homepage acquisition is recorded only after the HTML body was read successfully.

An earlier hybrid real 3M check used the subsequently rejected role-semantics bundle. Its recovery is **not a gain of the final retained implementation**. The final implementation was instead checked with a synthetic timed-out Lufthansa homepage and the previously captured, identity-verified raw Commons SVG. The retained SVG normalizer and unchanged ranker admitted the reviewed Lufthansa wordmark (hash `08d5ac5e7c619ef7931ca95af2831ce82fca11882dbb56267da1f9e01c464eda`). There were two synthetic homepage failures, one local asset replay and zero live HTTP requests; public URL/DNS safety checks still ran. The old timeout gate necessarily throws for this sequence. This is a deterministic integration check, **not** a real Lufthansa outage or cold API benchmark.

## Reproduction and artifacts

```sh
node scripts/experiments/missing-role-audit.mjs
node scripts/experiments/missing-role-ablation.mjs
node scripts/experiments/official-missing-role-ablation.mjs
node scripts/experiments/timeout-commons-recovery.mjs --id lufthansa --input runs/missing-logo-program-2026-09-19/baseline-all/rows/lufthansa.json --capture runs/missing-logo-program-2026-09-19/captures/923f5d2e389a7bc79ad065a7df0b39de8201df55fcec629219d607ef9775162d.json --synthetic-timeout
node --test test/homepage-timeout-recovery.test.mjs test/wordmark-recovery.test.mjs
```

The isolated role ablation injects verified canonical-filename evidence into local role semantics only for its experimental arm. Production does not consume that filename. Its kept development report is a record of the rejected experiment. Original download auditing made 26 requests totaling 219,998 response bytes; 21 files validated before SVG repair. Audit JSON embeds validated asset bytes; exported assets, contact sheets, live official captures and the hybrid timeout report live under ignored `runs/missing-logo-program-2026-09-19/roles/`. Compact tracked role results are in `role-ablation.json` here. 19 focused tests pass (13 original wordmark tests and 6 homepage-timeout tests); the new canonical-filename treatment test was removed with the rejected implementation. Full-check results belong to the parent experiment report.
