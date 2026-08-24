# Wide logo improvement plan v2

Date: 2026-08-23

## Goal

Move verified portable wide-logo recall from 61.0% into the mid-to-high 60s while keeping overall wide identity/role precision at or above 96.0%. Treat rendered header crops as a separate fallback tier unless they prove accurate and clean enough to promote later.

Keep this as three small experiments. Do not build another crawler or run a broad weight search.

## What the data now says

The frozen benchmark has 385 current-company sites:

| Metric | Current |
| --- | ---: |
| Correct wide selections | 235 |
| Wide selections | 243 |
| End-to-end recall | 61.0% |
| Identity/role precision | 96.7% |
| Correct wide candidate available | 252 |
| Correct candidate available but not selected | 17 |
| No correct wide candidate | 133 |

The original discovery opportunity was overstated. Ninety-nine misses have some visual instance classified as a horizontal lockup, but only 36 have one in the header or navigation. Body and footer lockups are dominated by customer, partner, publication, and content logos.

Within the 133 discovery misses:

- 104 captures succeeded and 107 have complete resources.
- 37 have no candidate records.
- 35 companies have an unmapped header/navigation lockup.
- 13 have a real observed source URL marked `candidate-not-retained`.
- 25 have an URL-free rendered instance; 34 of the 35 have a crop.
- The URL and URL-free groups overlap.

The URL-observed group contains obvious first-party header assets for companies such as Raywatt, MattoBoard, Cited & Seen, AdQuick, DNA Chat, Simuland, beebizy, and Wortal. It also contains malformed `/null` URLs that must be rejected rather than downloaded.

The URL-free crops are mixed. Some are tight, valid wordmarks, including Cure Genetics, DNA Chat, HN Novatech, and QuarkChain. Others are whole navigation bars, marketing text, background fragments, or clipped marks. They cannot all be promoted safely.

Two avenues are now closed:

- CSS mask and pseudo-element URL recovery added zero attributable selections in a paired 67-site development experiment.
- Existing deep-wide and SPA discovery added zero selections on 58 residual sites.

## Experiment 1: rescue correct candidates already in the pool

This is the highest-confidence opportunity: 17 sites already contain an adjudicated correct wide candidate, but the system does not select it. Most are abstentions rather than wrong selections.

### First produce a case ledger

For each of the 17, record:

- selected candidate or abstention;
- correct alternatives and their role scores;
- raw and content-box aspect ratios;
- region, home-link, logo-token, company-name, and rendered evidence;
- generic-exclusion reason;
- whether the miss is eligibility, shape, identity veto, or ordering.

Implement only mechanisms that explain at least two development cases. Do not add company-specific exceptions.

### Test these changes independently

1. **Make logo evidence consistent.** A strong `logo`, `brand`, or `wordmark` token in the asset path currently increases the score but does not satisfy `hasWideEvidence`. Count it as placement evidence only when the element is in the header/navigation and the asset has strong first-party provenance. Strong provenance means same-site, or a visible home-linked element using a known CDN asset; a filename alone is not enough.
2. **Narrow the false foreign-logo veto.** Do not apply the foreign-name veto to a positive-token header/navigation asset when it is home-linked or same-site. Keep the veto for body/footer and unlinked assets, where partner logos are common.
3. **Handle legitimate shape edges with strong evidence.** Test ratios from 1.4–1.8 and 12–16 only when identity and placement evidence are strong. Prefer a measured content-box ratio over declared canvas dimensions. Do not globally widen the current 1.8–12 band.
4. **Use visible mapping only as corroboration.** When two candidates are otherwise close, prefer the candidate mapped to an exact or derived visible header instance. Never let mapping admit an unsafe candidate by itself.

Run these as separate replay profiles before combining them. Expected realistic gain: 8–12 portable wide logos.

## Experiment 2: stop dropping visible header assets

The 13 `candidate-not-retained` companies are a retention problem, not a discovery problem.

### Instrument before changing behavior

On those 13 sites, record the exact drop stage:

- browser semantic filter;
- invalid URL normalization;
- duplicate removal;
- download/validation failure;
- candidate budget or final eight-item browser slice;
- identity or role eligibility.

This prevents treating several different failures as one bug.

### Likely small fixes to test

- Reject literal `null`, `/null`, empty, and blob-only asset URLs early while continuing to inspect sibling `currentSrc`, `srcset`, and inline SVG evidence.
- Use the same localized-home definition in browser discovery and visual capture. A same-host `/en` or `/de` root should count as home-linked in both.
- Feed rendered width and height into browser discovery priority. They are currently stored in `declared`, while the priority function reads declared `sizes` text.
- Within the existing browser budget, reserve up to two slots for visible, wide-shaped header/navigation or home-linked assets. Do not simply increase the total budget.
- Allow a visible header image with weak text semantics through validation when it is home-linked and wide-shaped; retain the normal identity and generic-content gates afterward.

Use the previous paired control/treatment harness on the development members of this exact group, then validation once. Expected realistic gain: 4–8 portable wide logos.

## Experiment 3: separate rendered-wordmark fallback

Only run this when no portable wide candidate survives. The output should initially be `rendered_wide`, not silently mixed into the primary `wide` result.

### Candidate construction

- Start from the smallest visible descendant inside the suspected logo container, not the whole header.
- Require header/navigation placement.
- Require home-link evidence, a positive logo token, or normalized company-name agreement in nearby DOM text.
- Require a rendered box no wider than 400 px, no taller than 120 px, less than 80% of the viewport width, and an aspect ratio between 1.8 and 12.
- Trim uniform background padding with the existing image tooling and reject a crop that becomes empty, is clipped at an edge, or still contains navigation/buttons/unrelated text.
- Capture at most one light and one dark version.
- Tag the result as background-dependent and rank it below every portable SVG or raster asset.

Do not introduce OCR or a vision model in the first pass. Use DOM text/placement gates and blind human review to learn whether the simple crop rules are sufficient.

Expected realistic gain: 4–7 usable rendered wordmarks. Report these separately. Promote this tier into the main wide result only if new-selection accuracy is at least 90% and overall precision remains at least 96.0%.

## Evaluation protocol

For every experiment:

1. Develop on the development split and measure behavior across the full development population, not only the known misses.
2. Blind-review every newly selected or changed wide result.
3. Record correct additions, incorrect additions, abstentions converted, existing correct selections lost, and total selection churn.
4. Verify that icon and favicon selections are unchanged.
5. Record fallback-only requests, bytes, p50 latency, and p95 latency.
6. Make one keep/drop decision on validation.
7. Do not tune repeatedly on the already-consumed evaluation split. Confirm the final bundle on a fresh, blindly labeled company sample.

Keep a change only when:

- newly selected wides are at least 90% correct;
- overall wide identity/role precision remains at least 96.0%;
- no existing correct wide, icon, or favicon selection regresses;
- the behavior is explained by a general rule, not one company;
- added network cost stays confined to sites missing a wide result.

## Expected outcome

| Tier | Realistic gain | Resulting recall |
| --- | ---: | ---: |
| Existing-candidate rescue | +8 to +12 | 63.1%–64.2% |
| Header-asset retention | +4 to +8 | 64.2%–66.2% combined |
| Separate rendered fallback | +4 to +7 | 65.2%–68.1% including rendered results |

The honest target is roughly 66% portable recall, with a possible high-60s user-facing answer rate when rendered fallbacks are counted separately. A header-focused system cannot approach the theoretical mid-70s ceiling because most remaining sites expose no trustworthy header wordmark evidence.

## Explicit non-goals

- No more mask or pseudo-element work.
- No deeper crawler or broader SPA/brand-page search.
- No body/footer eligibility relaxation.
- No broad rank-weight grid search.
- No forced answers for failed, ambiguous, parked, or unreachable sites.
- No crop promotion merely to hit a numeric target.

## Independent review

Claude Opus and ox-alpha independently reviewed the code and measured miss breakdown. Both recommended reversing the old discovery-first priority: fix the 17 proven candidate/eligibility misses, then diagnose the 13 dropped header URLs. Both warned that the 99-lockup statistic mostly reflects unsafe body/footer content and that crop output must be tightly gated. Claude recommended excluding crops from the primary wide metric; ox-alpha supported a small crop experiment as a separate fallback. This plan adopts that separation.
