# Bounded sitemap/robots missing-wide fallback

Date: 2026-08-26

Decision: **ship as an explicit, default-off capability; do not promote to default-on**

Compact results: [`../reports/sitemap-wide-fallback-2026-08-26/results.json`](../reports/sitemap-wide-fallback-2026-08-26/results.json)

## Outcome

The final treatment reads only robots-declared sitemaps on the official registrable domain, considers strongly named brand/press/media/logo pages plus shallow `/company`, `/about`, and `/corporate` pages, and fetches at most one page. A low-intent corporate/about page can contribute a candidate only when the candidate itself has exact company-plus-logo evidence. The treatment sends no more than four candidates through the existing validation, byte deduplication, content-box, role ranking, diagnostics, and provenance machinery.

It runs only when `wide` is missing. All additions are forced to the wide role, and the addition set is rolled back if any populated icon, wide, or favicon role would move. The low-level runtime option is `extractLogos(website, { sitemapWide: true })`; it remains false by default.

The main frozen development cohort recovered two reviewed-correct wides, P&G and Anthropic, from 48 misses: 2/2 correct, 100% observed strict precision, 4.167% answer rate, and 4.167 correct gains per 100. There were zero wrong-brand, related-brand, not-logo, or ambiguous admissions and zero populated-role movements. The wider original-500 development cohort admitted nothing on 102 misses. Combined development yield is therefore 2/150, or 1.333 gains per 100, below the requested 2/100 promotion target when both cohorts are pooled.

Two untouched validation cohorts then abstained on all 51 misses with zero role movement. This confirms conservative behavior but not effectiveness. Two successes are also far too few to establish a population-level 98% precision claim. The evaluation split was never opened. The evidence supports a useful opt-in recovery, not default-on promotion.

## Final metrics

| Cohort | Misses | Answers | C/W/R/N/A | Strict precision | Gains / 100 | Requests | Bytes | Mean / p50 / p95 ms | Worst requests / bytes / ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Major brands development | 48 | 2 | 2/0/0/0/0 | 100% observed | 4.167 | 132 | 13,148,751 | 752 / 498 / 2,142 | 5 / 2,168,308 / 8,304 |
| Original-500 development | 102 | 0 | 0/0/0/0/0 | n/a | 0 | 206 | 7,115,368 | 491 / 266 / 1,468 | 7 / 1,055,144 / 3,137 |
| Major brands validation | 16 | 0 | 0/0/0/0/0 | n/a | 0 | 46 | 3,070,177 | 1,540 / 685 / 8,428 | 5 / 1,059,961 / 8,428 |
| Original-500 validation | 35 | 0 | 0/0/0/0/0 | n/a | 0 | 82 | 5,437,996 | 658 / 460 / 1,499 | 9 / 1,403,054 / 2,787 |

`C/W/R/N/A` means correct, wrong-brand, related-brand, not-logo, and ambiguous reviewed admissions. Every row had zero sitemap-attributable icon, populated-wide, and favicon movement.

Frozen reranking moved two major-development icons, one original-development icon, fifteen original-development favicons, and three original-validation favicons. No frozen wide moved. These changes arise from replaying the old controls through the current ranker and are reported as baseline-version drift, not sitemap effects.

## Frozen inputs

| Artifact | SHA-256 |
| --- | --- |
| Major development control | `d650b0a423bf730962eef5276e186fe33e531045a3f8c259c56da285cf959359` |
| Major development split | `6750e75ba64306dbf7784661c5c317bb2635b6a6149790b377dfe3d1b9abe720` |
| Major development capture, 130 entries | `39c0d5e35b7180765079c5f07440e5ea1c926663321af4f3a7ee4a2458322a87` |
| Original-500 control | `c6ed742e7b1b5e572fed60e1fe4520f371fd4e6fb77b55901add9e13f0b469ea` |
| Original-500 development split | `da6cb03ae1b94d53cb6fbb2d3743e3a9ea7b28a7b8f9ca1cb91fc264bcdc1e11` |
| Original-500 development capture, 371 entries | `0d37b4148855e3367346bed159e516671814be38152abbbdc44da737d60435ce` |
| Major validation control | `22451cb39032df010f444ed7c7a2fee4bcf3cd7681721812ec4888846b7bc3a4` |
| Major validation split | `55568d6b5bdaf25713afe11d53778d2e9258d68d8e30c3338856f2f66186d25a` |
| Major validation capture, 48 entries | `21d121695b0c4b98fa8436d070745ed865559f48add252fc6bee5c851e929881` |
| Original-500 validation split | `45d00206d9f8fde51b950e74c3ebe8c0af5a24f1a30c07cc50330bb85868d0ed` |
| Original-500 validation capture, 81 entries | `66e53381f35723f86bf5648908a83806bea5a7efad28d7adfe4f0c5f98389d82` |

The harness accepts only development or validation, maps each control row to the frozen split assignment, rejects duplicate or missing IDs, and has no evaluation configuration. Frozen candidate bytes are rehydrated only from content-addressed asset roots after verifying their stored SHA-256. Both control and treatment candidates receive identical content-box, tiny-suitability, preference normalization, and ranking work.

Replay latency is the recorded transport latency; nondeterministic local image-processing time is excluded. Per-variant request and byte metrics reconstruct standalone treatment costs from the recorded resource metrics even when the widest matrix run warmed one shared response cache. Replay proves deterministic treatment behavior; separate tests cover live URL validation and redirect safety.

## Availability and prevalence

| Cohort | Robots declared | Sitemap parsed | Eligible page | Candidate domain |
| --- | ---: | ---: | ---: | ---: |
| Major development | 33 / 48 | 24 / 48 | 6 / 48 | 3 / 48 |
| Original-500 development | 57 / 102 | 49 / 102 | 19 / 102 | 1 / 102 |
| Major validation | 12 / 16 | 9 / 16 | 1 / 16 | 1 / 16 |
| Original-500 validation | 25 / 35 | 19 / 35 | 5 / 35 | 2 / 35 |

The final major-development failure ledger was: page network 1 and oversize 1; robots HTML 6; sitemap HTML 1, HTTP 403 7, HTTP 404 4, malformed XML 2, oversize 7, and timeout 2. The original-development ledger was: page HTTP 404 1 and oversize 1; robots HTML 8 and oversize 2; sitemap HTML 1, HTTP 403 1, HTTP 404 1, and malformed XML 4. Failures remain abstentions with diagnostics.

## Variants and direction changes

The broader original-500 development capture provides a same-capture cost comparison:

| Variant | Answers | Requests | Bytes | Mean / p50 / p95 ms | Worst requests / bytes / ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Robots strict, one page | 0 | 186 | 2,443,614 | 420 / 209 / 1,082 | 7 / 877,743 / 3,137 |
| Robots strict, two pages | 0 | 190 | 2,810,226 | 430 / 209 / 1,170 | 7 / 1,197,207 / 3,137 |
| Robots corporate, one page, final exact gate | 0 | 206 | 7,115,368 | 491 / 266 / 1,468 | 7 / 1,055,144 / 3,137 |
| Robots corporate, two pages, final exact gate | 0 | 214 | 7,591,402 | 507 / 266 / 1,527 | 9 / 1,197,207 / 3,137 |
| Conventional strict, one page | 0 | 230 | 6,747,782 | 434 / 269 / 1,393 | 4 / 1,037,035 / 2,864 |
| Robots + conventional strict, one page | 0 | 341 | 7,314,906 | 730 / 464 / 2,103 | 7 / 1,038,537 / 3,354 |

Iterations:

1. Robots-only, conventional-only, union seeding, scores 55/80, one/two pages, four sitemap documents, and lastmod freshness were tested. Conventional and second-page work added requests and bytes without a correct gain.
2. An early broad page treatment surfaced a Vodafone body photograph. Generic body-photo exclusion and exact identity checks removed it.
3. Exact page-label evidence for a cross-domain asset recovered P&G from the official P&G logos page. Cross-domain candidate redirects were then set to zero.
4. A shallow corporate/about treatment recovered the exact-labeled Anthropic inline wordmark from `https://www.anthropic.com/company`. This is the only measured gain from lowering the page score from 80 to 25.
5. A broader live run briefly surfaced a valid Palantir mark through deep API documentation. General URL penalties for docs, documentation, developer, and API paths removed that semantic-scope error without a company rule.
6. The original-500 run surfaced Robomotion, but a fresh homepage-only check produced the identical hash, proving live-web drift rather than a sitemap-attributable gain. The final low-intent exact-identity gate also removes it from replay. The remaining validated Peppa candidate was square/icon-shaped and did not enter wide.
7. Two final replays confirmed that one-to-two pages changes original-development cost from 206 to 214 requests and 7,115,368 to 7,591,402 bytes with zero gain. Further crawler breadth is not justified.

The stopping point is robots-only, three sitemap documents, and one page. Extra pages, conventional guesses, link following, archive inspection, retries, and larger page bodies produced no measured benefit.

## Selected proposals

- P&G: official black wordmark from `https://us.pg.com/newsroom/multimedia/logos/`; asset hash `6093eeebfd29bfd21eeae10edee47c9dcda3a3c81d5a47cad14add8765f857e5`; review fingerprint `sha256:280315d93fce704f1346f4501f5941907f2e63d95bd7e5edc1ee04e02a52b9e1`. Its 400×400 raster canvas has measured wordmark-wide content.
- Anthropic: exact-labeled 570×64 inline SVG from `https://www.anthropic.com/company`; asset hash `e204d48e3628c4aa168b790523ca5a4ed50efef804040dced1994d6aa20ccf56`; review fingerprint `sha256:f57a8edf94693086cc05cb8eddf74848b4578351dc3ab1b679900279b97ddc6e`.

Both were visually reviewed as correct. Fresh homepage-only extraction returned no wide for P&G or Anthropic, so both are attributable to the sitemap treatment rather than homepage drift.

## Resource and safety contract

Runtime ceilings:

- robots: 128 KiB;
- sitemap documents: 3;
- per-sitemap compressed bytes: 256 KiB;
- per-sitemap expanded bytes: 1 MiB;
- sitemap URLs considered: 5,000;
- official pages: 1 at 1 MiB;
- page-nominated candidates: 4;
- discovery: 12 request hops, 5 MiB, 16 seconds;
- total discovery plus candidate validation: 16 request hops, 8 MiB, 20 seconds;
- per-resource timeout: 4 seconds;
- official-domain redirects: 3, revalidated before every hop;
- cross-domain candidate redirects: 0.

Callers may lower numeric limits but cannot loosen seed mode, score threshold, page count, or host policy through `sitemapOptions`. Byte accounting includes chunks consumed before oversize aborts. Header and body work share a resource deadline. The overall time budget is checked at resource and candidate boundaries; bounded local CPU work can finish after the nominal wall-clock threshold.

The implementation uses the existing public-address validator and homepage parser. All sitemap and page redirects remain on the original registrable domain. Cross-domain assets require exact company-plus-logo accessible labels, are validated on their admitted registrable domain, and cannot redirect. DNS rebinding between validation and connection remains an inherited limitation of the shared HTTP client; eliminating it requires address-pinned connections and is outside this optional fallback.

Gzip is detected by magic bytes and capped before and during expansion. HTML masquerading as XML, DTD/entity declarations, malformed or truncated XML, loops, duplicates, bad redirects, missing bodies, and all optional-fallback exceptions fail closed. XML tag-like text inside a comment can cause a conservative false-negative. No new XML dependency was added.

## Independent reviews

The locally installed OpenCode CLI was inspected with `opencode --help` and `opencode run --help`. A final read-only review used `openrouter/z-ai/glm-5.3-flash` in plan mode and reran focused tests. It found no code blocker. Its two high-priority findings were stale decision artifacts and missing independent adjudication for the new Anthropic gain. The artifacts were regenerated from the four final summaries; Anthropic adjudication was requested from Claude Opus in a read-only session. GLM also identified non-blocking limitations: inherited DNS-rebinding TOCTOU, boundary-granularity wall-clock ceilings, development multiple-comparison exposure, machine-local frozen asset paths, replay's capture-hash trust model, and conservative rejection of tag-like text in XML comments.

A separate Claude Code MCP review used `claude-opus-5` with only Read, Glob, and Grep tools. It was forbidden from editing code, running shell commands, using the network, or opening evaluation data. It independently derived that the nine path groups in the frozen 570×64 SVG spell “Anthropic” and returned `correct`. Because the reviewer model is made by Anthropic, that result is explicitly recorded as a second review rather than arm's-length independent adjudication. Its compact verdict is in [`../reports/sitemap-wide-fallback-2026-08-26/independent-adjudication.jsonl`](../reports/sitemap-wide-fallback-2026-08-26/independent-adjudication.jsonl).

Opus also found two concrete final-pass issues. First, exact-identity logic could inspect the raw payload of a `data:` URL; it now excludes data payloads and relies only on DOM evidence, with a low-intent inline-SVG regression test. Second, the matrix harness validated a URL once with whichever variant's evidence was retained last; validation is now isolated per variant while the transport capture remains shared, and the complete original-500 matrix was replayed. The final metrics did not change. Its concern that the asset host policy also controlled exact body-candidate admission was removed by making exact candidate identity a separate same-domain admission condition; the host policy now only governs off-domain assets.

Earlier GLM and Opus passes found and prompted fixes for unsafe page-body images, optional validation, missing total budgets, redirect limits, response classification, failed-read accounting, percent decoding, sitemap loops/deduplication, cross-domain label identity, zero cross-domain redirects, control hydration/hash verification, control/treatment content-box symmetry, normalized preferences, retry waste, and header/body timeout double-counting. The final captures were replayed after all code changes.

## Promotion gates

| Gate | Result |
| --- | --- |
| At least 2 correct gains / 100 main development misses | Pass: 4.167 |
| At least 2 correct gains / 100 pooled development misses | **Fail: 1.333** |
| At least 98% observed strict precision | Arithmetic pass: 2/2; statistically unestablished |
| Zero new wrong-brand domains | Pass |
| Zero populated icon/wide/favicon movement | Pass |
| Enforceable resource ceilings | Pass |
| Non-zero validation confirmation | **Fail: 0/51 answers** |

Recommendation: ship the implementation and experiment tooling as a small, explicit, default-off recovery option. Do not enable it by default. A promotion attempt needs a freshly frozen missing-wide cohort, a preregistered treatment, non-zero validation gains, independent adjudication, and enough proposals for a meaningful precision bound.

## Reproduction

Major development:

```bash
node scripts/experiments/sitemap-wide-experiment.mjs --split development --cohort major-brands-300 \
  --control /Users/hendrik/Documents/logo-yoink/runs/major-brands-v4-cycle/rank-v6-development/results.jsonl \
  --control-assets /Users/hendrik/Documents/logo-yoink/runs/2026-08-24-major-brands-300-stage-2 \
  --variant robots_corporate_exact_cdn_1 \
  --replay runs/sitemap-wide-development-v18-corporate-final/web-capture.jsonl.gz \
  --reviews reports/sitemap-wide-fallback-2026-08-26/development-corporate-reviews.jsonl \
  --output runs/sitemap-wide-development-v21-reviewed-final
```

Original-500 development uses the same command with `--cohort original-500`, the control at `runs/ranking-v10-integration/original-500/results.jsonl`, all three `final-remaining-300`, `final-static-100`, and `final-holdout-100` asset roots, and capture `runs/sitemap-wide-original500-development-v2-matrix/web-capture.jsonl.gz`.

Validation replaces `--split development` with `--split validation` and uses the matching final capture. The final replay outputs are `sitemap-wide-development-v21-reviewed-final`, `sitemap-wide-original500-development-v6-reviewed-final`, `sitemap-wide-validation-v9-reviewed-final`, and `sitemap-wide-original500-validation-v3-reviewed-final`. The corrected full matrix is `sitemap-wide-original500-development-v7-matrix-final`.

Verification commands:

```bash
npm run check:syntax
node --test test/sitemap-discovery.test.mjs test/sitemap-wide-experiment.test.mjs test/http-client.test.mjs test/extractor.test.mjs test/public-api.test.mjs
npm run check
```
