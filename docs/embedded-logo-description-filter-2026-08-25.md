# Embedded-logo description filter — 2026-08-25

## Decision

Keep. Ranking v7 rejects a body/content image when its alt text describes a
logo embedded at a location inside a larger scene instead of naming the image
itself as a logo. This fixes the live Apple failure without adding a company
allowlist or changing discovery surfaces.

## Reproduced Apple failure

On the live `apple.com` homepage, ranking v6 returned the correct 302×302 Apple
mark from Organization JSON-LD for the icon role. It incorrectly returned a
1,262×580 Apple Card product photograph for the wide role. The photo's alt text
contains “Apple logo in top left,” so the static parser assigned positive logo
evidence; company-name agreement then made the opaque product photo wide
eligible. Because the wide slot appeared filled, the rendered fallback did not
run.

A browser inspection confirmed that Apple's global navigation contains a
home-linked inline SVG Apple glyph. Apple exposes no separate horizontal
corporate wordmark on the homepage. The correct result is therefore the
official icon plus no wide asset—not the product photograph and not a
synthesized wordmark.

## Fix

`describesEmbeddedLogo()` recognizes the bounded structural distinction between:

- an asset label such as `Subway logo with honey dipper`, which may be a valid
  brand lockup; and
- narrative image text such as `Apple Card, front, Apple logo in top left`,
  where the mark is merely an object inside a larger image.

It requires both a narrative prefix (a clause/comma or at least four words
before `logo`, `wordmark`, or `brand mark`) and a locative description after the
mark (`in`, `on`, `corner`, `center`, `background`, and related terms).
Discovery marks these candidates as negative context before the download budget
is assigned. Ranking applies the same veto to frozen or cached candidates whose
older evidence predates the parser change.

Live replay after the fix returns the structured Apple icon and `logo: null` in
both static and browser-enabled modes. Browser-enabled replay performs the
bounded rendered search but still finds no defensible wide mark.

## Frozen evidence

All comparisons reused frozen bytes and v4 candidate labels.

| Split | Changed selection | Before | After | Decision |
| --- | --- | --- | --- | --- |
| Development | BMW wide | Spider-Man campaign photograph | withheld | correct removal |
| Validation | Apple wide | iPhone product photograph | withheld | correct removal |
| Evaluation, opened once after freeze | Lyft wide | QR-code image | related-brand asset | neutral non-correct→non-correct |
| Frozen 500 | none | — | — | zero movement |

There are zero correct-to-non-correct regressions and zero new wrong-brand
domains. The full 300-company score remains 66.19 because the scorer already
gave no correctness credit to the removed false slots. Correct selected slots
remain 286, while selected slots fall from 368 to 366; strict selected precision
therefore rises from 77.72% to 78.14%. Explicit selected `not_logo` cases fall
from 35 to 32, with the Lyft replacement moving one case to `related_brand`.

This is a product correctness improvement rather than score gaming: returning
no wide asset is better than returning a product photograph. The rule does not
synthesize a logo, add a network request, invoke AI, or modify icon/favicon
selection on the frozen sets.

## Cost and verification

The frozen experiment added zero requests, bytes, browser invocations, or API
model calls. The live Apple diagnostic used one static extraction, one
browser-enabled extraction, and one Playwright inspection. Focused tests cover
both the Apple-style narrative photo and the valid Subway lockup control.

Raw replay output is under gitignored
`runs/major-brands-embedded-logo-fix/`. Ranking-v6 frozen-500 output was reranked
to `runs/2026-08-25-frozen-500-embedded-logo-fix`; the exact v6→v7 comparison
contains zero flips.
