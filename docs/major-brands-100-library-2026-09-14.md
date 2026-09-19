# Major brands 100 — verified pilot

Checked 14 September 2026 (Australia/Hobart).

## Outcome

This repository now contains a usage-oriented, exactly 100-identity pilot library with stable IDs, canonical domains, aliases, parent/product distinctions, approved immutable source bytes, provenance, hashes, dimensions, format, role, locale, theme, and separate `lastCheckedAt` / `lastConfirmedCurrentAt` timestamps.

The approved manifest contains 173 selected assets: 96 icon/symbol selections and 77 company-name wordmarks or full lockups. Linear also has a separately preserved official dark-surface wordmark variant, for 174 approved files referenced by the manifest. The immutable store contains additional replaced and staged versions so review history is not destroyed.

This is not a claim that these are the mathematically largest companies. The cohort deliberately mixes global public companies, major private companies, consumer identities, financial services, industrial/transport brands, and frequently displayed software brands. The requested prior samples are included: Linear, Neon, PostHog, Nubank, Itaú, Inter, Netflix, Amazon, and Revolut.

## Selection and identity rules

A record represents the displayed identity named in `sources.json`, not every product owned by its parent. Parent/product relationships are explicit (for example GitHub → Microsoft, Slack → Salesforce, TikTok → ByteDance, and Disney → The Walt Disney Company). Aliases resolve to the same identity but are not treated as extra brands.

First-party homepages, brand pages, press centers, and downloadable kits were preferred. Public Wikimedia and Simple Icons fallbacks were used only when first-party discovery was missing or blocked, and each such asset retains its discovery page and source kind. Amazon's wordmark is the original 6110 × 2047 PNG from the official Amazon press center. Inter and Revolut wordmarks are preserved reviewed first-party rendered captures from the preceding evidence packet. No paid/key-dependent provider, fabricated lettering, recoloring, or upscaling was used.

The visual contact sheets were inspected by Codex on both light and dark backgrounds. This is AI-assisted review, not independent human review. Review removed or replaced Toyota's shopping-cart glyph, Pepsi's Facebook glyph and historical mark, Cisco's Story Lab sub-brand, American Express and Goldman Sachs navigation chevrons, Ford's location pin, Disney's Disney+ product tile, L'Oréal's UI ring, and compact wordmarks incorrectly occupying icon roles. Nike's Swoosh remains an icon only and is not counted as a company-name wordmark.

## Coverage and explicit gaps

Icon/symbol coverage is 96/100. The four intentional gaps are Disney, L'Oréal, Zara, and FedEx: reviewed compact candidates were a product tile, UI glyph, or the full wordmark rather than a separately verified symbol.

Company-name wordmark/full-lockup coverage is 77/100. The 23 explicit gaps are Apple, McDonald's, Nike, Airbnb, Xiaomi, TikTok, Alibaba, JD.com, Target, Louis Vuitton, BMW, Mercedes-Benz, Volkswagen, Porsche, Shell, bp, GE, UPS, Nubank, Itaú, GitLab, X, and Snapchat. Several of these identities intentionally lead with a symbol or monogram; others remained inaccessible or did not expose a separately verifiable current company-name asset during targeted research. These gaps remain data, not hidden fallbacks.

All canonical selections are original source bytes. Linear is the one verified official light/dark wordmark pair promoted from a brand-kit archive: the dark artwork is selected for light surfaces and the light artwork is stored as a dark-surface variant. Other assets use `theme: any` unless a distinct source variant was verified; the light/dark sheets expose practical contrast limitations without recoloring originals.

## Maintenance behavior

`scripts/brand-library.mjs` implements a deliberately small review gate:

1. `brands:refresh` writes a timestamped run, preserves every candidate in the content-addressed immutable store, and never changes `manifest.json`.
2. Byte-identical content is `unchanged`; identical bytes at a new URL are `equivalent_artwork_new_url`.
3. Visually identical artwork with more pixels is `better_quality_same_artwork`.
4. A visual difference is `possible_rebrand` and stays staged.
5. Missing or blocked sources are `blocked_or_missing_retained`; the approved asset remains available.
6. `brands:approve` is the explicit promotion step after review. Rejections and role gaps are recorded in the brand notes.

The controlled classifier test covers unchanged, equivalent-new-URL, better-quality, possible-rebrand, retained-on-failure, and missing-without-approved cases.

A bounded live recheck of Amazon, Linear, Neon, PostHog, and Revolut produced seven unchanged roles, one equivalent-artwork/new-URL icon, and two missing wordmark candidates retained from the approved library. No approved file was overwritten. The report is in `runs/2026-09-14T10-52-21-028Z/report.json`.

## Commands

```sh
npm run brands:refresh -- --workers 4
npm run brands:supplement
npm run brands:curate
npm run brands:review
npm run brands:approve
npm run brands:verify
npm run brands:self-test
```

Use `--only amazon,linear` or `--limit 10` for bounded refreshes. Do not approve a refresh until its report and both contact sheets have been reviewed. Source pages and trademark/usage restrictions remain authoritative; inclusion in this dataset does not grant trademark rights, and Wikimedia license metadata does not waive trademark restrictions.

