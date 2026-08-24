# Current logo-system optimization results

Date: 2026-08-23

## Outcome

The retained bundle contains two small changes:

1. Favicon selection now ranks 32 px visual suitability, intended intrinsic size, and agreement with the icon signal ahead of a weak HTML-icon tie-break. The signal is measured from already-downloaded bytes; it does not add requests or change role eligibility.
2. Rendered browser discovery now runs only when there are no candidates or no eligible wide result. Existing request, byte, timeout, and candidate caps are unchanged.

The frozen labels, packet membership, assignments, candidates, and baseline were not modified. No live recrawl was used for tuning.

## Reproducible baseline

The offline command is:

```sh
npm run visual-benchmark:replay -- --baseline-check --output /tmp/logo-yoink-baseline.json
```

It verifies the frozen label SHA-256, all 1,155 selection slots, the stable aggregate sections, and the exact unrounded quality subtotal of `55.467532467532465/90` (`55.47/90`). Experiment replay defaults to development and validation; evaluation must be requested explicitly.

## Keep/drop decisions

| Experiment | Development | Validation | Decision |
| --- | --- | --- | --- |
| Favicon tiny-suitability reorder | Correct 84→134; wrong identity 13→11; answers 204→204 | Correct 20→41; wrong identity 9→9; answers 74→74 | Keep |
| Unsupported favicon-family icon demotion | Correct 169→168; wrong identity 15→16; answers unchanged | No improvement | Drop |
| Captured both-theme wide tie-break | No selection or theme-usability improvement | Not promoted after development miss | Drop |
| Same-site header-wide eligibility recovery | Correct unchanged; wrong identity 2→3; answers 154→155 | Correct 52→53; wrong identity unchanged | Drop: development regression |

The favicon gain is not an abstention effect: answer rate is unchanged in both tuning splits. The icon experiment failed because most unsupported wrong icons have no eligible correct alternative. The theme experiment failed because the frozen deployable evidence does not identify the reviewer-known alternatives; label usability was not used as a ranking feature.

## Final evaluation (one post-freeze run)

| Favicon metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Correct selections | 25 | 41 | +16 |
| Answers / answer rate | 58 / 79.5% | 58 / 79.5% | 0 |
| Wrong identity | 1 | 1 | 0 |
| Role precision | 43.1% | 70.7% | +27.6 pp |
| End-to-end recall | 34.2% | 56.2% | +21.9 pp |
| Best-hit rate | 32.5% | 77.5% | +45.0 pp |
| Usable on any theme | 25 | 41 | +16 |
| Usable on both themes | 25 | 38 | +13 |

Icon and wide selections are unchanged by the retained ranking bundle. Consequently, evaluation wrong-brand icon/wide domains remain 4 and the label-based `50.55/90` evaluation quality subtotal is unchanged because that legacy subtotal excludes favicon quality.

## Combined frozen population

Across development, validation, and the single final evaluation, favicon correct selections rise from 129 to 216 while answers remain 336. Wrong-identity favicon selections fall from 23 to 21, role precision rises from 38.4% to 64.3%, end-to-end recall rises from 33.5% to 56.1%, best-hit rate rises from 30.5% to 66.4%, and both-theme usable selections rise from 124 to 204.

The retained changes do not reduce the frozen 29 wrong-brand icon/wide domains. The attempted generic icon demotion made that metric worse and was therefore rejected instead of converting discovery failures into abstentions or different wrong answers. Improving this safety metric requires better evidenced icon discovery, not a broad source penalty.

## Verification

Targeted tests cover pixel suitability, role isolation, neutral handling when a pixel measurement is unavailable, the missing-wide browser gate, capture snapshots, and exact replay. The complete repository test and fixture-validation command is `npm test`.
