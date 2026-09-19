# Missing-logo experiment program — 2026-09-19

The retained changes improve asset validation, repeat-request cost, and recovery after homepage timeouts. They do **not** increase Wikimedia discovery or relax ranking, identity, URL safety, or BIMI requirements. The canonical-filename ranking experiment was rejected after it lost a correct held-out TEPCO wordmark.

## Measured results

The fresh census contains exactly **1,000 identities, 812 with approved art, 979 approved assets** (978 primary assets plus one variant). There are **188 missing-any-art identities, 314 missing icons, and 708 missing wide logos**. The primary experiment covers the missing-any-art set; role gaps across the other identities are inventoried, not exhaustively recollected.

| Missing-art cohort | Companies | Discovered, before → after | Validated, before → after | Automatic light-theme role output, before → after |
| --- | ---: | ---: | ---: | ---: |
| Development | 140 | 76 → 76 | 66 → 74 | 52 → 59 |
| Held out from tuning | 42 | 29 → 29 | 25 → 29 | 23 → 27 |
| Evaluated total | 182 | 105 → 105 | 91 → 103 | 75 → 86 |
| Protected frozen evaluation | 6 | Not run | Not run | Not run |

The **11 additional automatic outputs are not 11 approved library additions**. Every changed output was reviewed on white and dark contact sheets against identity/currentness evidence. **Seven passed review: six development and one held-out recovery.** Six have direct official asset/document comparisons; Lufthansa's seventh relies on official brand-continuity evidence because its live site blocked retrieval. A stricter fresh-file-only count is therefore six. The [visual audit](../reports/missing-logo-program-2026-09-19/svg-final-review/review.md) records the evidence and limits.

| Reviewed recovery | Role | Evidence level |
| --- | --- | --- |
| Barrick Mining | Wide | Q2 2026 official fact sheet |
| Castorama | Wide | Parent's November 2025 presentation |
| Intesa Sanpaolo (held out) | Wide | Current official header and brand page |
| Lufthansa | Wide | Official design and brand-continuity statements |
| MSC Group | Icon | Current official Organization logo asset |
| Nippon Steel | Wide | Current official header |
| TRATON | Wide | Currently served official GROUP media variant |

Cardinal Health and Royal Caribbean remain on hold for stacked-layout mismatch, Ola for a glyph difference from its current official header, and Saks for uncertain current compact variant/icon legibility. These four illustrate why automatic role output is not usable-art precision. The runtime still selects these four; the hold is a research/library review decision, not a new automatic currentness or visual-role filter. Thus this program does not claim production precision improved or that its outputs can bypass review. The [seven reviewed research files](../reports/missing-logo-program-2026-09-19/reviewed-candidates/manifest.json) retain hashes, transformations and provenance. Berkshire is the twelfth newly decodable file but still fails the existing aspect-ratio rule. No library approvals were added or existing approved assets overwritten.

All 40 independent previously approved control companies retained the same discovered URLs, validation results, and selected roles: 21 Commons discoveries, 21 validated, 19 selected. The approved-library compatibility experiment tested all 979 assets: 974 → 976 passed the runtime validator, with zero regressions; the two improvements were already-approved Patagonia and Ray-Ban assets, not missing-company gains. Full development SVG ablation used 1,055 inputs (979 controls + 76 discovered development files), recovered ten decodable files, and showed pixel-identical rendering for every normalization.

## What was kept and rejected

| Experiment | Observation | Decision |
| --- | --- | --- |
| Strict legacy SVG normalization | Removes only the canonical SVG 1.1 PUBLIC DOCTYPE from a fully scanned, static, self-contained document; +12 decoded missing-company files, +11 automatic role outputs | Keep; record raw hash and transformation, retain BIMI restrictions |
| Compact cached entity records | Same P856/P154 verification and provenance; 37-domain repeat workload changed from 146 API requests / 18.74 MB to zero / zero | Keep; cold wire bytes unchanged |
| Shared rate-limit cooldown | Initial census hit widespread 429s; Retry-After had not coordinated separate company lookups | Keep; cached answers remain available, later calls respect cooldown and their deadlines |
| Independent coalesced deadlines | A follower could inherit the owner's longer wait | Keep; timeout a follower without cancelling the owner |
| Homepage timeout recovery | Two native timeouts prevented independent Commons recovery; body-read failure could prematurely mark a homepage reached | Keep; skip extra default favicon probes, retain failure diagnostics and mixed-failure exclusions |
| Verified Commons filename in role semantics | Development gained 3M; held-out `TEPCO symbol.svg` was actually a wordmark and incorrectly lost its wide role | Reject entire change; ranking restored byte-for-byte to synchronized baseline v12 |
| Existing official/deep discovery, eight exposed cases | No incremental validated candidates or usable roles; several sites unreachable | Do not expand crawling based on this result |
| Filtered claims endpoint / speculative searches | Property-specific endpoint would increase request fanout; no reliable measured advantage | Do not ship |

The retained normalization never resolves a DTD, custom entity, script, external reference, or CSS dependency. It scans the complete document, not only the metadata sniffing prefix. It rejects internal subsets and anything outside its restricted static grammar, then applies the normal image and render checks. Original and normalized hashes allow auditing the transformation. No logo was fabricated or reconstructed.

Timeout recovery is enabled only when all attempted homepage failures are timeouts and Wikimedia is enabled. DNS/TLS/redirect mixtures, parked content, and disabled Wikimedia retain their prior failure behavior. Jina failures receive the same classification. Explicitly requested optional providers can still run; with defaults, the additional recovery is the independently verified Wikimedia stage. This can add the existing resolver and asset-download budgets after a failed homepage; there is no new claim of a global extraction deadline.

## Cost, latency, and capture discipline

Production resolver deadline remains **5 seconds**, capped at 10 seconds for explicit research use. Existing JSON and asset limits remain **4 MiB and 3 MiB**. Production API cache limits remain **32 MiB / 256 entries / six-hour TTL**. The static safety checks and API identity checks are unchanged in strength; malformed name-search responses now fail closed instead of silently dropping hits.

The initial concurrent census returned 115 rate-limited missing-company outcomes and the initial 40-control run was entirely rate-limited. These are recorded as transport observations, **not missing-logo evidence**. The runner was changed to acquire sequentially with 650–700 ms request spacing and provider-wide Retry-After handling, reuse successful captures, and retry the one incomplete STMicroelectronics capture. Final paired results contain no unresolved rate-limit or acquisition errors.

Final missing-set replay used the same 834 captured API/asset responses and 54,538,402 response bytes for each implementation, with **zero live HTTP requests**. Control replay used 176 captured responses / 10,662,818 bytes. Replay performs ordinary public-URL/DNS validation but is not a live latency benchmark. Capturing can wait for provider cooldowns beyond an individual resolver deadline; acquisition timings are therefore not production latency measurements.

The cache-only ablation used the unchanged production cache capacity and two passes over 37 previously exposed development domains. Discovery stayed 21/37. The old cache churned and rerequested all 146 APIs on the second pass; the projected cache retained all 146 entries in an accounted 2.30 MB and needed no repeat requests. The memory figure uses the existing serialized-size multiplier, not measured RSS. Local replay CPU time fell from roughly 488 ms to 8 ms for that repeat pass. Larger working sets remain subject to the 256-entry cap.

A separate fresh live sample, collected sequentially after the rate limit cleared, found:

| Domain | Baseline cold | Treatment cold | Warm observation |
| --- | --- | --- | --- |
| Schneider Electric | Timeout at 5 s | Timeout at 5 s | Both succeeded on partially cached retry, about 2.5 s and two more requests |
| Lufthansa | Success, 3.11 s | Success, 3.39 s | Both fully cached, zero requests |
| Traton | Success, 2.28 s | Success, 1.83 s | Both fully cached, zero requests |

These small sequential observations are subject to network/server variation. **No cold-recall improvement is claimed**, and Schneider's cold five-second gap remains. The retained timeout path is also covered by a synthetic Lufthansa homepage-timeout integration with original captured SVG bytes, normal URL checks, normalization, and unchanged ranking. The earlier live 3M hybrid recovery belonged to the rejected ranking bundle and is not a retained gain.

## Remaining gaps and interpretation

| Final stage across the 182 evaluated missing-art identities | Count |
| --- | ---: |
| Automatic role output; requires currentness, role and rights review | 86 |
| Valid art but no eligible requested role/theme | 17 |
| Unsafe, unsupported or unrenderable SVG | 2 |
| Multiple domain-matched entities | 26 |
| No verified official-domain match | 19 |
| No current logo claim | 24 |
| Ambiguous current logo claims | 3 |
| No search candidates | 4 |
| Indexed website-search truncation | 1 |

The six protected identities are Aldi, Marriott, Lyft, Bank of America, The New York Times, and Etihad Airways. They remain explicitly unmeasured in this program; existing frozen labels and evaluation outputs were not opened or changed. The all-company inventory retains their previous research and approval gaps.

The two remaining SVG rejections are BSH (SVG 1.0 DOCTYPE) and PVH (styles outside the static normalization grammar). They were not relaxed to improve the reported score. Compact/stacked marks, extreme-width Berkshire artwork, stale branding, and identity ambiguity remain real gaps. Existing research records mark 11 missing identities with permission constraints; four automatic outputs overlap those records. A Commons license field is not permission to redistribute a trademark or proof of current branding.

The next useful experiments are: a fresh labelled role dataset for stacked/compact marks; authoritative redirect/alias corroboration for domain mismatches; a separately audited SVG 1.0/static-style extension; and review of the already-discoverable output queue. More broad search or crawl fanout should follow evidence of discovery failure, with provider pacing and request budgets. The current-round holdout is now consumed and must not be reused for tuning a follow-on experiment.

## Reproduction, provenance and changes

The new worktree started at the same commit as the source, `b6c214bab5a805d22c656a628a897318e6a531fd`, but lacked the source's uncommitted implementation and library. Exactly 1,957 scoped files were copied from `/Users/hendrik/.codex/worktrees/36ac/logo-yoink` without modifying that worktree. A per-file SHA-256 transfer record and a complete pre-experiment `src/` snapshot are under `runs/missing-logo-program-2026-09-19/`. The current library manifest still hashes to `4fc29e2f8407c7d5c730e4166fa16d0c5984ed79e7e1e400aec76e9ab79a5a4e`.

The deterministic inventory was defined before tuning: prior exposed domains go to development, protected frozen-evaluation domains are excluded, and remaining domains use SHA-256 assignment. This yielded 140 development and 42 held-out missing identities. Implementation hashes were frozen before opening paired holdout results. The keep/drop record preserves the rejected bundle and the final retained hashes. No replacement rule was tuned against TEPCO.

New production changes relative to that synchronized source are confined to `src/extractor.mjs`, `src/standalone-svg.mjs`, and `src/wikimedia-fallback.mjs`. Tests cover malicious/encoded resources, DTD/entity rejection, full-document scans, rendering equivalence, provenance, BIMI, native/Jina timeout handling, parked sites, mixed failures, malformed API payloads, cache equivalence, host cooldowns, and coalesced deadlines.

```sh
node scripts/experiments/missing-logo-inventory.mjs

# Use existing local captures: baseline is the synchronized source, not git HEAD.
node scripts/experiments/missing-logo-program.mjs \
  --source runs/missing-logo-program-2026-09-19/baseline/src \
  --output runs/missing-logo-program-2026-09-19/baseline-final \
  --capture runs/missing-logo-program-2026-09-19/captures-paced --split all --offline
node scripts/experiments/missing-logo-program.mjs \
  --output runs/missing-logo-program-2026-09-19/treatment-final \
  --capture runs/missing-logo-program-2026-09-19/captures-paced --split all --offline
node scripts/experiments/missing-logo-compare.mjs \
  runs/missing-logo-program-2026-09-19/baseline-final/report.json \
  runs/missing-logo-program-2026-09-19/treatment-final/report.json \
  reports/missing-logo-program-2026-09-19

node scripts/experiments/wikimedia-cache-capacity.mjs
node scripts/experiments/svg-doctype-recall.mjs \
  --captured-rows runs/missing-logo-program-2026-09-19/baseline-final/rows \
  --captures runs/missing-logo-program-2026-09-19/captures-paced \
  --output runs/missing-logo-program-2026-09-19/svg/full-development
npm run check
```

For a fresh acquisition use a new capture directory, omit `--offline`, and use `--workers 1 --request-interval-ms 700`; do not combine independent live workers against the provider. Use `--controls` for the fixed 40-company control cohort. Captures, original bytes, intermediate baselines, failed runs, and full response provenance remain ignored local research artifacts, not frozen benchmark fixtures. The main inventory, paired comparison, visual decisions and gap analysis are in `reports/missing-logo-program-2026-09-19/`.

Final verification: **454 tests passed**, plus syntax checks, fixture validation, local smoke, both library verifiers, library self-tests, and `git diff --check`. The approved library remains 812 identities / 979 assets. Nothing was published, deployed, pushed, or purchased.
