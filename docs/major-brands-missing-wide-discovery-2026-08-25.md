# Major-brands missing-wide discovery experiment — 2026-08-25

## Decision

Stop with no runtime change. The existing rendered browser tier visually
recovered six correct corporate wides from the 54 development domains with no
captured usable correct wide, but it also selected an Apple App Store badge and
a SAS Viya product mark. Target strict precision was therefore `6/8 = 75%`, and
the App Store badge created a new wrong-brand domain. The treatment also did not
meet a hard resource-bound interpretation: although requests beyond the browser
route budget were aborted, observed request events reached 394 and declared
response bytes reached 35.4 MB on one domain.

The already-implemented official-page/archive and one-bundle SPA treatment
found no target-category development gain. Its only development addition was a
correct Anthropic archive wordmark, but Anthropic already had a frozen correct
wide candidate and belonged to the eligibility-loss category. A one-shot
validation confirmation produced zero additions. No new discovery rule clears
development precision, wrong-brand safety, target prevalence, bounded cost, and
validation confirmation together.

No evaluation split or evaluation label was opened or used. Frozen inputs were
read in place and not modified. No company-specific exception was added.

## Cohort and holdout discipline

The independently reviewed v4 labels were filtered to the source-controlled
development IDs before label fields were inspected. The frozen rank-v6
development replay contains 180 entities, of which 130 are reachable. Among
those, 76 have at least one v4-labeled usable correct wide candidate and 54 have
none, reproducing the development share of the all-cohort 90-domain loss.

Of the 54 target domains, 41 had no selected wide and entered the rendered
fallback. Seven additional development domains with an eligibility or selection
miss also entered, giving a 48-domain safety denominator. The validation split
was used only after the deep treatment completed development with one visually
correct addition; evaluation remained untouched.

Immutable input digests and compact machine-readable results are in
[`summary.json`](../reports/major-brands-missing-wide-discovery-2026-08-25/summary.json).

## Rendered first-party surfaces

The existing bounded browser adapter inspects light and dark rendered states,
visible header/navigation/banner and home-linked images, safe inline SVG, and
computed CSS backgrounds. Observations were warmed once, then replayed from
preserved JSON and candidate bytes.

| Metric | Development result |
| --- | ---: |
| Queue / successful observations | 48 / 46 |
| Validated additions / domains | 49 / 21 |
| New selected wides | 9 |
| New selected target-category wides | 8 |
| Correct selected wides, all / target | 7 / 6 |
| Wrong-brand / related-brand selections | 1 / 1 |
| Browser requests / declared bytes | 4,109 / 142,376,391 |
| Candidate-validation requests / bytes | 54 / 2,889,999 |
| Browser latency p50 / p95 | 2,388 / 3,788 ms |

Five selected additions were rendered inline SVGs and four were rendered
images. Computed CSS backgrounds produced two validated candidates but zero
selections. The nine selected assets were rendered together on white and dark
panels; the fingerprint-bound review ledger is
[`selected-additions-review.jsonl`](../reports/major-brands-missing-wide-discovery-2026-08-25/selected-additions-review.jsonl).

The correct target gains were Philips, Kakao, Ryanair, Duolingo, Canva, and
Palantir. Anthropic was also correct, but its frozen taxonomy was an eligibility
miss rather than a discovery miss. Khan Academy selected an Apple App Store
badge, and SAS selected the related SAS Viya product identity. This fails both
the strict precision and zero-new-wrong-brand gates before validation.

## Static structured and deep surfaces

Static organization JSON-LD is already parsed by current `main`. The 54 target
domains contain seven frozen `schema` candidates, including two selected
non-correct wides, but exhaustive v4 review identifies no usable correct wide
from schema or any other frozen static source. Adding another schema parser is
not supported by this evidence.

The bounded deep treatment pairs the normal extractor with up to two semantic
first-party pages, selective ZIP inspection, and at most one same-origin SPA
entry bundle. It never changes icon or favicon roles.

| Split | Attempts | New target wides | Other new wides | Request delta | Byte delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| Development | 48 | 0 | 1 correct Anthropic archive SVG | +65 | +18,325,430 |
| Validation | 16 | 0 | 0 | +20 | +4,617,141 |

The negative duration delta on validation is ordinary live-network variance,
not a claimed saving. The deep capability already exists and is enabled in the
public demo, so the experiment provides no new implementation to promote.

CSS masks and pseudo-elements were not reimplemented: the repository's prior
67-domain development experiment found zero attributable selection, and the
current rendered run again found zero selected CSS-background candidate. This
is corroborating evidence, not a new evaluation of the old frozen cohort.

## Limitations and next experiment

The rendered observations are live-web evidence, so their HTML and transfer
sizes are not byte-stable even though replayed candidate bytes are frozen after
capture. Declared `Content-Length` accounting is not a strict transferred-byte
cap, and aborted requests still count as request events. The visual review is a
targeted before/after adjudication, not a replacement for adding new candidates
to the exhaustive benchmark label set.

The next concrete experiment should first make the browser budget enforceable
and replayable: record response-body bytes as they stream, stop the page when
the request or byte ceiling is reached, and persist a terminal budget reason.
Then test one development-only structural admission profile using the frozen
observations: retain only a home-linked candidate or a header/banner mark, and
reject generic store/download badges. That profile would exclude the two
observed non-correct selections without a company allowlist. It must be warmed
fresh on development, independently reviewed, and only then confirmed once on
validation. Promotion still requires at least two correct target gains per 100
audited misses, at least 98% strict new-selection precision, zero new
wrong-brand domains, zero icon/favicon movement, and demonstrated per-domain
request, byte, and latency ceilings. Evaluation should remain sealed until a
treatment passes all earlier gates.

## Reproduction

Ignored experiment artifacts are under
`runs/major-brands-missing-wide-2026-08-25/`. The important paths are
`browser-observations/`, `browser-replay/`, `changed-wide-review/`, `deep-wide/`,
and `deep-wide-validation/`.

```sh
node scripts/experiments/warm-browser-observations.mjs \
  /Users/hendrik/Documents/logo-yoink/runs/major-brands-v4-cycle/rank-v6-development \
  runs/major-brands-missing-wide-2026-08-25/browser-observations 2 12000 0
node scripts/experiments/replay-browser-observations.mjs \
  /Users/hendrik/Documents/logo-yoink/runs/major-brands-v4-cycle/rank-v6-development \
  runs/major-brands-missing-wide-2026-08-25/browser-observations \
  runs/major-brands-missing-wide-2026-08-25/browser-replay
node scripts/experiments/deep-wide-experiment.mjs \
  /Users/hendrik/Documents/logo-yoink/runs/major-brands-v4-cycle/rank-v6-development/results.jsonl \
  runs/major-brands-missing-wide-2026-08-25/deep-wide 48
node scripts/experiments/deep-wide-experiment.mjs \
  /Users/hendrik/Documents/logo-yoink/runs/major-brands-v4-cycle/rank-v6-validation/results.jsonl \
  runs/major-brands-missing-wide-2026-08-25/deep-wide-validation 60
```
