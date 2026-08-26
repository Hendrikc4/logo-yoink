# BIMI DNS logo fallback experiment — 2026-08-25

## Decision

Do not implement or enable the BIMI fallback. The experiment found valid domain-declared SVG assets, but it produced zero incremental correct-logo coverage over the existing extraction and cached-favicon pipeline.

This document records a negative experiment result only. No BIMI DNS lookup, parsing, fetching, ranking, CLI/API option, or runtime behavior from the prototype is included in `main`.

## Scope

The major-brands benchmark contains 300 companies split into:

- Development: 180 companies
- Validation: 60 companies
- Evaluation: 60 companies

BIMI prevalence and paired fallback behavior were tested on development and validation, for 240/300 companies total. The 60-company evaluation split remained unopened for tuning or scoring, so this is not a full-300 result.

## Results

The all-domain prevalence pass found:

| Split | Domains | BIMI assertions | Retrievable, safety-valid SVGs |
|---|---:|---:|---:|
| Development | 180 | 46 | 44 |
| Validation | 60 | 26 | 25 |
| Combined | 240 | 72 | 69 |

The runtime-shaped fallback was gated to domains lacking a defensible first-party icon:

| Split | BIMI attempts | Valid SVGs retrieved | BIMI icons selected | Correct | Wrong brand | Incremental correct selections |
|---|---:|---:|---:|---:|---:|---:|
| Development | 18 | 5 | 3 | 3 | 0 | 0 |
| Validation | 4 | 1 | 1 | 1 | 0 | 0 |
| Combined | 22 | 6 | 4 | 4 | 0 | 0 |

The four changed selections were Workday, Adobe, Nvidia, and Salesforce. Every BIMI SVG was the correct brand and appropriate for the icon role, but every control already had a correct cached favicon. Correct-role coverage therefore stayed 4/4 in both arms.

The changed assets moved from four third-party cached rasters to four domain-controlled, self-asserted SVGs. That improved provenance and scalability, but it did not improve correctness. Mean tiny-render suitability decreased from 97.825 to 96.650: one selection improved, one was unchanged, and two worsened.

Combined gated BIMI-stage cost was 22 DNS requests, 7 HTTP requests, 9,089 downloaded bytes, and 58 ms p50 / 203 ms p95 / 414 ms maximum latency. These figures describe the BIMI stage, not a full pipeline run with every optional fallback configuration.

## Safety observations

The prototype treated BIMI as a domain-controlled self-assertion, not as certificate-verified or license-cleared evidence. An optional `a=` evidence-document pointer was recorded but not validated. DNS control does not establish trademark or license permission.

An initial rule admitted correct-brand wide lockups padded onto square canvases. A general measured-artwork shape guard removed those icon-role false admissions without company-specific exceptions. Independent review later found that a production version would also need to fail closed for intrinsically wide canvases and unmeasurable artwork, isolate resolver caches, avoid caching transient DNS failures, preserve redirect/private-address checks, and prevent fallback-order side effects.

Post-freeze, non-scoring live controls observed an accepted default assertion for `apple.com` and no default assertion for `google.com`, `nike.com`, or `pepsi.com`. Live DNS records can change after the experiment date.

## Conclusion

BIMI had measurable prevalence and supplied four safe, correct icon alternatives, but it delivered no additional correct logos on the 240-company development-and-validation surface. The provenance benefit and bounded stage cost do not justify adding runtime complexity, DNS/network work, or another self-asserted input source when correct-role coverage remains unchanged.

Reconsider BIMI only if a future frozen cohort demonstrates incremental correct selections with zero wrong-brand admissions and acceptable end-to-end cost. Any future test should freeze the rule on development, confirm once on validation, and leave evaluation untouched until promotion criteria are met.
