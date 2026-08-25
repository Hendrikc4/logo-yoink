# First-party wide-logo discovery experiment — 2026-08-23

## Decision

Retain the implementation as two explicit, conditional options. `--deep-wide` enables a bounded official brand-asset graph and safe selective ZIP inspection only when wide is missing. `--spa-bundles` adds a one-entry-bundle SPA probe. Neither is default, neither can select icon/favicon, and the existing asynchronous browser remains the broader fallback.

The SPA treatment passed the development prevalence and precision gates after one precision refinement: 3 correct additions in 75 frozen misses (4.0 per 100), 100% strict reviewed precision, zero wrong-brand domains, and zero icon/favicon movement. The official archive path has convincing named controls but zero feature-attributable wins in the frozen missing-wide slice, so it remains optional/on probation rather than promoted by cohort coverage.

No paid API, external catalog, image search, Wikipedia, or third-party logo database is used. Every accepted asset has a first-party link chain.

## Architecture and trust boundary

- The default parsed homepage path is unchanged. Deep semantic evidence and entry scripts are collected only when `deepWide` is enabled; legacy `brandPages` behavior is separately preserved.
- Link evidence retains anchor text, `aria-label`, title, nearby heading, bounded card/section text, source page, and resolved URL.
- Page traversal is capped at two fetched high-intent pages. Off-domain HTML is fetched only when an official page explicitly links a company-agreeing logo/brand gallery. Direct downloads must have focused logo/brand/press-kit evidence.
- Every network hop, redirect, page, archive, member, and SPA asset passes the extractor's public-URL/port/DNS checks. Off-domain acceptance is provenance, not hostname prestige.
- Deep candidates carry `eligible_roles: ["wide"]`; icon and favicon cannot move.

ZIPs are inspected in memory with Node's built-in `zlib`; no archive dependency was added. The reader requests the suffix/central directory with `Range` and `Accept-Encoding: identity`, validates `206` and `Content-Range`, carries an ETag/Last-Modified validator through `If-Range`, and then fetches only ranked member ranges. A server returning `200` is accepted only as a capped full fallback (12 MB). Limits/rejections cover traversal/absolute/drive/NUL paths, encrypted entries, multi-disk/ZIP64 markers, nested archives, symlinks, unsupported compression, malformed or conflicting directory/local headers, 512 entries, 12 path components, 3 MB compressed members, 6 MB uncompressed members, 100:1 expansion, 8 MB total ranged bytes, and 64 MB selected expansion total. Oversized irrelevant press-kit photos are skipped rather than downloaded.

Archive ranking prefers SVG, company agreement, wordmark/lockup/horizontal/primary/full-logo terms, and color/default variants. It penalizes icons/symbols, badges, powered-by marks, screenshots/headshots, deprecated/legacy/vertical assets, macOS resource forks, and known product/subbrand terms. Theme variants are preserved.

The SPA probe runs only on shell-like pages, fetches at most one same-origin `main`/entry bundle capped at 2.2 MB, and accepts at most four same-origin image literals. A literal needs a strong logo/wordmark/lockup filename plus expected-company or ≥3-character title-derived acronym agreement. Oversized bundles are recorded misses, not extraction failures.

## Three substantive iterations

1. **Implementation and adversarial fixtures.** Added semantic evidence, provenance chains, range ZIP parsing, selective in-memory inflation, role isolation, archive member/theme classification, and the single-bundle probe. Deterministic tests exposed a lying suffix range and product conflict; both were fixed.
2. **Named live controls and root-cause refinement.** Anthropic initially failed on redirect-to-ZIP, oversized irrelevant photos, and `__MACOSX` resource forks. Content-type detection, selective oversize skipping, and fork exclusion produced the correct 590×68 Slate/Ivory variants. GitHub exposed queue pollution and Copilot confusion; focused link priority and product vetoes produced GitHub lockups only. Cloudflare exposed unrelated headshot/badge/network downloads; focused direct-link gating reduced the graph to `Logos.zip`. Katalon selected `[Primary Logo]` SVG plus variants.
3. **Frozen paired ablation and precision refinement.** The first SPA rule selected five assets, two wrong (Quansys→Sangrah and General Instinct→Samsung), so it failed at 60% strict precision. Requiring company/title-acronym agreement removed both. The final paired run produced Optilyx, Amukha, and Remitation only; all three were already confirmed as first-party wide assets in the repository's browser audit and were re-inspected on light/dark backgrounds. Four >2.2 MB bundles that initially failed the treatment were converted to non-fatal misses, yielding 75/75 successful pairs.

The requested ox-alpha critique ran twice through `openrouter/stealth/ox-alpha`: first before implementation, then after the paired-v2 results. Its actionable findings (range validation, product isolation, default-path laziness, acronym boundary, range happy-path coverage, and non-fatal oversize handling) were verified and incorporated. It did not edit the worktree.

## Frozen paired result

Source control: `runs/review-final-remaining-300/results.jsonl` in the intentionally ignored local run tree. The experiment deterministically reproduced the existing `missing-wide-root-cause-audit-v1` 75-domain slice and ran live control then treatment for each domain.

| Metric | Result |
|---|---:|
| Successful pairs | 75/75 |
| Feature-attributable new wide | 3 |
| Correct / ambiguous / wrong | 3 / 0 / 0 |
| Strict incremental precision | 100% |
| Correct wins per 100 audited misses | 4.0 |
| Icon / favicon movements | 0 / 0 |
| Treatment cost delta | +47 requests, +15,797,966 bytes |
| Mean cost per successful domain | +0.63 request, +210,640 bytes |

Control-first/treatment-second latency was cache-order biased (the treatment summed 28.6 seconds faster), so no latency improvement is claimed. Request and byte deltas are retained; live/CDN variance still applies.

Visual verdicts are tracked in [`deep-wide-changed-review-2026-08-23.json`](../reviews/deep-wide-changed-review-2026-08-23.json). All three are correct but theme-conditional: Optilyx is suitable on dark, while Amukha and Remitation are primarily suitable on light.

## Named live controls

The reproducible control harness writes full diagnostics with:

```sh
node scripts/experiments/deep-wide-controls.mjs runs/first-party-wide-controls-2026-08-23/results.json
```

Observed on 2026-08-23:

| Control | Result | Requests / bytes / latency | Finding |
|---|---|---:|---|
| Anthropic | `Anthropic logo - Slate.svg`, 590×68; Ivory alternate | 15 / 794,786 / 2.036 s | Correct company wordmark; ranged 26.47 MB ZIP, four selected SVG/PNG members |
| GitHub | `GitHub_Lockup_Black.svg`, 416×95; white alternate | 18 / 1,268,097 / 1.665 s | Correct company lockup; Copilot/product members withheld |
| Katalon | `[Primary Logo]Full_Color_Black_RGB.svg`, 692×203 | 21 / 471,510 / 1.968 s | Correct primary company logo with reverse/black/white variants |
| Cloudflare | `CF-Logo 1.png`, 512×173 candidate | 9 / 3,053,452 / 3.586 s | Correct candidate; existing homepage inline SVG remains higher-ranked; headshots/badges/network art excluded |
| Stripe | no archive candidate from homepage graph | 9 / 1,705,840 / 1.840 s | Existing homepage inline wordmark remains; `/newsroom/information` is not exposed by the bounded homepage graph, so sitemap expansion was not forced |
| Slack | explicit Salesforce/Widen gallery reached; no static asset | 19 / 460,114 / 1.839 s | Provenance accepted to the official gallery; JS/auth-style collection remains a miss |
| pnptc.com | `assets/pnp-logo.svg`, 144×40 | 19 / 1,975,198 / 1.718 s | One 1.85 MB entry bundle; normal logo beats white alternate |

Three additional fresh pnptc repetitions were stable at 19 requests and 1,975,198 bytes, with 0.979/1.010/1.598 s latency. The supplied browser reference was 87 requests, about 2.45 MB, about 3.3 s, and hit the resource cap. The bundle probe is cheaper on this control, while the browser remains more general.

## Retained and dropped decisions

- **Retained optional:** bounded semantic graph, complete provenance, range ZIP reader, theme variants, and company-wide archive ranking.
- **Retained optional:** one-entry SPA probe with company/title acronym agreement. It clears the local development gate but has no untouched holdout; it is not default.
- **Retained:** browser fallback as the broad SPA/DOM path.
- **Dropped:** generic bundle literals without identity agreement (60% precision).
- **Dropped:** fetching every bundle or following a general JS module graph.
- **Dropped:** generic sitemap expansion in this cycle. It could recover Stripe's newsroom information path but repeats a previously zero-yield surface and adds cost to misses.
- **Dropped:** guessing around Slack's gallery or downloading non-static collection APIs without explicit asset links.

## Reproduction

```sh
npm ci
node --test
npm run fixtures:validate
node scripts/experiments/deep-wide-experiment.mjs \
  runs/review-final-remaining-300/results.jsonl \
  runs/first-party-wide-2026-08-23-paired-v3 75
node scripts/experiments/deep-wide-controls.mjs \
  runs/first-party-wide-controls-2026-08-23/results.json
npm run cli -- anthropic.com --deep-wide
npm run cli -- pnptc.com --deep-wide --spa-bundles
```

Run directories are intentionally ignored because they contain fetched assets. The tracked experiment script, tests, report, and review verdicts preserve the design and judgments; reruns preserve the full live request/byte/provenance diagnostics.
