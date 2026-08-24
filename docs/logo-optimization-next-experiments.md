# Next logo optimization experiments

Date: 2026-08-23

## Starting point

Keep the retained favicon change. It raised correct favicon selections from 129 to 216 with the same 336 answers, and evaluation role precision rose from 43.1% to 70.7%.

Do not retry the rejected icon source penalty, wide-theme tie-break, or broad wide-eligibility relaxation. They either regressed development or had no usable signal.

The remaining errors are different:

- Icon: 276 correct, 26 wrong identity, and 32 misses where a correct icon already exists.
- Wide: 235 correct and only 17 avoidable ranking misses; discovery remains the main limitation.
- Favicon: 216 correct with 53 avoidable misses remaining. Only 2 of those have a correct alternative with a higher current tiny-suitability score, so another weight tweak is unlikely to help.

## Experiment 1: recover rendered header wordmarks

Wide is now the primary improvement track. Of the 133 current-company sites without a verified wide candidate, 99 already have a rendered visual instance classified as a horizontal lockup. Thirty-five have an unmapped horizontal lockup in the header or navigation.

Close the narrow gap between visual capture and browser discovery:

- Extract computed `mask-image` URLs in addition to `background-image` URLs.
- Inspect `::before` and `::after` for background and mask URLs.
- Keep this bounded to visible header/navigation or home-linked elements.
- Reuse the existing URL normalization, download limits, and identity checks.
- Rank recovered real assets through the normal wide pipeline; do not add a special score boost.

Test first on development sites missing a verified wide candidate, then make the keep/drop decision on validation. Blind-review every newly selected wide logo. Keep the change only if it adds verified company wordmarks without adding definite partner, customer, or footer logos.

## Experiment 2: bounded rendered-crop fallback

Some visible header wordmarks have no recoverable asset URL. For those only, test an element screenshot crop as a last-resort wide candidate:

- Require a visible header/navigation or home-linked horizontal lockup.
- Use it only when normal extraction produced no eligible wide logo.
- Capture at most one light-theme and one dark-theme crop per company.
- Mark crops as rendered fallbacks and rank them below real image/SVG assets.
- Reject crops containing surrounding navigation, buttons, or unrelated text.

This improves practical coverage but may produce background-dependent PNGs. Report transparent/portable assets separately from rendered crops so the headline result stays honest.

## Experiment 3: verify the rendered fallback live

The new fallback gate is retained but its discovery gain cannot be measured from frozen candidates. Run a paired live test on development and validation sites with either zero candidates or no wide selection:

1. Run static extraction as control.
2. Run the bounded rendered fallback as treatment.
3. Blind-review only newly added icon/wide candidates.
4. Compare correct additions, wrong-brand additions, requests, bytes, and latency.

Keep it only if it adds several correct logos, adds no definite wrong-brand logos, and keeps the extra cost confined to fallback sites. If rendered discovery has low yield, compare the existing deep-wide path on the same misses rather than inventing another crawler.

## Experiment 4: favicon-to-icon visual agreement

The remaining favicon failures are not separated by the 32 px suitability score. Test one additional signal: visual similarity to the selected high-confidence icon.

- Compare downscaled/perceptual fingerprints of favicon candidates with the selected icon candidate.
- Use similarity only as a tie-break among favicon-eligible candidates; do not change eligibility or answer rate.
- Tune the threshold on development and keep it only if absolute correct selections also rise on validation with no wrong-identity increase.

Do not run a broad weight search. If this one signal does not transfer to validation, stop favicon work for now.

## Experiment 5: corroborated icon evidence

The earlier source penalty failed because it often replaced one wrong icon with another. Test corroboration instead of source demotion:

- Count independent support for the same asset/family: favicon declaration, structured metadata, DOM/header use, rendered instance, and company-name agreement.
- Prefer a corroborated icon only when it is close to the current icon score; never use corroboration to admit an otherwise ineligible candidate.
- Measure correct selections, raw wrong-brand count, and answer rate on development and validation.

If offline corroboration does not reduce wrong-brand selections without losing correct icons, drop it. The next icon step would then be targeted rendered discovery for evidence-poor sites, not more rank-weight tuning.

## Evaluation discipline

The original evaluation split has already been used once and should not be revisited during this cycle.

- Develop on development and make keep/drop decisions on validation.
- Keep each experiment isolated before testing a combined bundle.
- Preserve the current answer counts as guardrails.
- For wide experiments, report both verified wide coverage and wide identity/role precision. Do not trade away the current 96.7% precision for raw answer rate.
- After a bundle survives validation, confirm it once on a small fresh company sample with blind labels.

## Priority

1. CSS mask and pseudo-element recovery — direct, bounded gap affecting at least 35 header/navigation lockups.
2. Rendered-crop fallback — potentially larger wide gain, kept visibly separate from portable assets.
3. Live fallback verification — measure the full discovery gain and cost.
4. Favicon/icon visual agreement — cheap offline experiment with no new requests.
5. Icon corroboration — focused safety experiment.

Run the first three as the wide-logo pass. Do not revisit broad wide ranking weights unless the new discovery evidence creates a materially larger candidate set.
