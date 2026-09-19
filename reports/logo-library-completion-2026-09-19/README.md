# Logo library completion — 19 September 2026

All **1,000 identities in the existing roster now have approved artwork**. The 188 previously empty identities are filled. The roster is a usage-oriented mix of companies and product brands; it is not a financial ranking of the largest 1,000 firms.

| Coverage | Before | After |
| --- | ---: | ---: |
| Any approved artwork | 812 | 1000 |
| Icon | 686 | 782 |
| Company-name logo | 292 | 792 |
| Both roles | 166 | 574 |
| No approved artwork | 188 | 0 |
| Approved asset entries, including variants | 979 | 1575 |

Added 596 primary assets. All 978 original primary asset hashes are preserved. Company-name logos include horizontal, compact, and stacked artwork; those last two are not represented as legacy wide logos.

## What changed

Previously discovered files were often left outside the approved manifest. Collection also lost useful artwork through overly restrictive theme/native-size rules, and the review renderer could not display some legitimate ICO files. Recovery reused existing candidates, collected first-party artwork, and used targeted public file searches for remaining gaps. Contact-sheet review rejected wrong brands, photos, generic UI icons, and unsuitable role matches. Background-specific marks and genuine brand monograms were retained with appropriate labels. Known usage restrictions remain recorded alongside public artwork.

The app/API, CLI, and public `yoink` function now use the approved library for exact domains and explicit aliases. Missing requested roles or preferences still use live discovery, with approved roles retained on live failure. `library: false` / `--live` forces live collection. ICO decoding is shared by runtime measurement and review rendering. Packaging and deployment builds copy only approved assets into the runtime bundle.

The coverage command reads the approved manifest and committed research, so missing local run files no longer make already attempted companies appear unchecked. Research findings are evidence; the manifest determines actual coverage.

## Remaining variants

There are **218 missing icon roles** and **208 missing company-name roles**, listed in [remaining-roles.tsv](remaining-roles.tsv). Every listed brand already has another approved role. These include genuine wordmark-only brands and source or candidate gaps; the list does not assert that every brand necessarily has a separate icon and wordmark. Light/dark variants are also not universally complete.

The original logo-only assignment's review records 12 wordmark-only exceptions, 43 unresolved icon candidates/sources, and 7 transient acquisitions. The remaining role list also includes complementary roles on newly recovered identities. Those identities were completed with their available valid mark, without manufacturing alternate artwork.

The original icon-only assignment recovered 341 company-name logos from 520 brands. Its 179 remaining gaps comprise 25 blocked/unreachable acquisitions, 135 without a verified candidate, and 19 visually rejected candidates. Another 29 missing company-name roles belong to formerly empty identities now covered by icons. The final Commons batch added 68 approvals; eight selected files remained rate-limited after bounded retries.

## Evidence and repeatable checks

- [Approved manifest](../../brand-library/v2/manifest.json) and [current contact sheets](../../brand-library/v2/review/).
- [Recovery of all 188 empty identities](../missing-logo-library-2026-09-19/outcomes.json).
- [Icon review outcomes](../logo-only-icons-2026-09-19/outcome-report.json).
- [Company-name review decisions](../../brand-library/v2/icon-only-logo-review.json).
- [Final Commons batch](../../brand-library/v2/commons-logo-recovery-outcome.json) and [company-name gap reasons](../../brand-library/v2/icon-only-logo-gap-report.json).
- [Counts and preservation audit](summary.json); [runtime roster audit](runtime-roster-audit.json).

Validation passed: 497 automated tests, the full project check, the post-merge syntax check and manifest verification. All 1,000 domains returned every existing approved primary role from the extracted npm package with zero live calls; that audit requests available roles, not missing variants. The package contains 1,575 approved asset entries and no unapproved library files, at 23.8 MB compressed. All 20 approved-library contact sheets were regenerated. See [validation.json](validation.json).

Run `npm run check` for automated tests, local smoke checks, fixture checks, both manifest verifiers, and the review/update self-test. Run `node scripts/brand-library.mjs coverage --root brand-library/v2` for current counts, `node scripts/brand-library.mjs review --root brand-library/v2` to regenerate contact sheets, and `npm run brands:runtime` to rebuild the approved runtime bundle.

Work was split across four Codex tasks: recovery, company-name collection, icon/inventory repair, and runtime integration. Luna handled the initial routine inventory/collection; Sol handled implementation and visual review; Astra handled the difficult final empty-identity recovery. Changes are committed locally; no deployment, package publication, or push was performed.
