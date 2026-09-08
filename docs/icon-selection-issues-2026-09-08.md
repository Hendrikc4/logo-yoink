# Icon selection fixes — 2026-09-08

Ranking version 11 addresses GitHub issues #6–#11. Each issue was assigned to a
separate subagent, then reviewed and integrated against a snapshot of
the existing uncommitted workspace. Existing LinkedIn fallback and image
processing changes were preserved.

| Issue | Result |
| --- | --- |
| #6 | Canonical icons use measured occupancy, visible bounds, and requested-surface contrast. Blank or negligible artwork cannot return through favicon or SVG-twin fallback. |
| #7 | Wix and WordPress assets are recognized from normalized pixels across PNG/WebP sizes and encodings, including mirrored URLs and DOM logos. Explicit company identity or an exact owner domain preserves owner assets. |
| #8 | Edge-contact and content-shape diagnostics identify likely square wordmark crops. Ambiguous full-bleed geometry gets a small ranking penalty without losing eligibility or its resolution advantage. |
| #9 | Per-role `strict: true` enforces known color/background requirements and measured surface usability. API and CLI expose exact/fallback/unmatched selection status. Strict and best-effort HTTP responses remain distinct cache entries. |
| #10 | A declared favicon needs company, exact manifest-name, or eligible corporate-family corroboration to displace a likely company header mark. Investor/backer collections do not gain authority from navigation placement. |
| #11 | Portrait/team-photo context and person-style raster filenames are excluded using general placement and identity rules, including extensionless image endpoints. |

The pixel features share the existing bounded 32×32 decode. Background detection
uses that same analysis, eliminating the separate favicon background decode.
The changes add no dependency or image-fetch stage. Existing bounded fallback
stages may still run when a candidate is rejected or strict preferences abstain.

## Review and validation

- `npm run check`: syntax, benchmark qualification, fixture validation, and local
  homepage/docs/API smoke checks. The complete workspace passes 321 tests; the
  isolated publication commit passes 313 tests, excluding eight tests belonging
  to the earlier uncommitted LinkedIn/image-processing work.
- Regression coverage includes tiny/blank artwork, light/dark surfaces, opaque
  contrast, strict fallbacks, generic-platform owner exceptions, crop ambiguity,
  intact wide marks, navigation backers, and portrait identity guards.
- Offline replay: 500 existing company captures, 4,454 candidates. Baseline and
  revised selection both return 358 icons and 246 logos. Two canonical icon
  replacements; no previously reviewed correct selection becomes an abstention.
  The replay initially exposed intact elongated-icon exclusions and a navigation
  investor-logo promotion; both were corrected with general rules and regressions.

This replay uses cached observations and available local assets, not a fresh live
capture or an exhaustive new accuracy review. Historical published benchmark
claims remain scoped to their captured ranking version; current runtime
qualification remains explicitly false.

## Performance

Alternating baseline/current trials measured validation, pixel analysis, and
ranking for 24 candidates (eight favicon sources and sixteen DOM sources), after
warmup, with 60 samples per version. The baseline includes the user's original
uncommitted work. No network latency is included.

| Workload | Baseline median | Revised median | Baseline p90 | Revised p90 |
| --- | ---: | ---: | ---: | ---: |
| PNG | 51.72 ms | 35.68 ms | 53.82 ms | 37.63 ms |
| Mixed PNG/WebP/JPEG/SVG | 41.57 ms | 29.61 ms | 43.37 ms | 30.53 ms |

The mixed workload median improved 28.8%; PNG improved 31.0%. These are local
bounded-workload measurements, not a universal production latency guarantee.
