# Wikidata/Commons domain fallback experiment — 2026-08-25

## Decision

Keep the exact-domain Wikidata/Commons fallback behind the clearly named
`wikimediaFallback` / `--wikimedia-fallback` option. Do not enable it in the
public demo yet.

The frozen treatment added 21 visually reviewed correct wide selections in
development and three in validation. Strict incremental precision was 100% on
both splits, with no wrong-brand or related-brand admissions and no populated
first-party role displaced. This is promising, but the delta review has only one
review pass, validation has three admissions, and live control/treatment captures
had independent reachability drift. The extra request/byte cost is also material.
Those limits make opt-in release more defensible than changing normal runtime.

## Behavior and safety contract

The resolver receives only the supplied domain. It performs two bounded
Wikidata searches, inspects up to 12 distinct entity candidates, and never uses a
name or Wikipedia-title match as identity proof. An entity qualifies only when
an active best-rank P856 statement has exact public-suffix-aware registrable
domain agreement and uses the apex, `www`, a conventional corporate/about host,
or a language host. Arbitrary product subdomains do not prove corporate identity.

P154 selection removes deprecated, future, ended, and point-in-time-only claims,
then prefers current preferred-rank claims over normal-rank claims. Distinct
winning current files are ambiguous and cause abstention. Commons files are
resolved through `imageinfo`, must use the canonical Commons description host
and Wikimedia upload host, and then pass the normal SSRF, redirect, byte-limit,
image-sniffing, SVG normalization, SVG renderability, and pixel-safety pipeline.
License metadata is preserved with an explicit reminder that it does not waive
trademark restrictions.

Fallback candidates are eligible only for roles that were missing or failed the
requested variant preferences. A defensive post-rank check rejects the entire
addition if any other role moves. Returning null is expected.

## Development iteration

The v1 development run selected 22 Commons candidates. Visual inspection found
21 correct corporate wide marks and one related product: the Baidu input resolved
to a Baidu Baike logo because its P856 was under `baike.baidu.com`. The general
rule was refined to reject arbitrary product subdomains while retaining apex,
`www`, corporate/about, and language hosts. No company-specific exception was
added. Development v2 removed BaiduWiki and retained the 21 correct selections.
The code and options were then frozen before validation.

| Split | New correct icon | New correct wide | Strict precision | Wrong brand | Related brand | First-party displacement |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Development v2 (180) | 0 | 21 | 21/21 (100%) | 0 | 0 | 0 |
| Validation (60) | 0 | 3 | 3/3 (100%) | 0 | 0 | 0 |

Development fallback resolution ran for 57 reachable missing-role cases: 34
resolved a validated Commons file, 23 safely abstained, and no timeout, rate
limit, malformed-response, or other technical failure was recorded. Twenty-one
files were selected. Validation ran resolution for 21 cases: ten resolved a
file, eleven abstained, no technical failure occurred, and three files were
selected.

Separate live captures make total-cost deltas sensitive to site drift, but they
show the operational envelope:

| Split | Mean latency control → treatment | Mean requests | Mean downloaded bytes | p95 latency | p95 requests | p95 bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Development | 2,144.6 → 2,497.7 ms | 11.9 → 13.7 | 657,394 → 845,357 | 13,001 → 13,001 ms | 20 → 23 | 2,048,648 → 2,213,254 |
| Validation | 2,618.1 → 2,676.7 ms | 11.8 → 13.8 | 453,065 → 673,574 | 13,005 → 13,004 ms | 19 → 23 | 1,264,695 → 1,464,955 |

Development extraction failures moved 46/180 to 49/180 and validation moved
14/60 to 13/60. The changed failures occurred before the fallback stage and are
reported as live reachability drift, not treatment regressions.

## Live controls after freeze

All four requested controls were run after the rule was frozen. Google and Nike
belong to the benchmark evaluation assignment, so they were used only as live
smoke controls; no evaluation labels or aggregate score were opened.

| Domain | Normal extraction | Fallback result | Requests | Bytes | Latency |
| --- | --- | --- | ---: | ---: | ---: |
| google.com | root favicon; wide missing | abstain: multiple exact-domain product entities | 7 | 890,614 | 1,562 ms |
| apple.com | Schema.org icon; wide missing | abstain: multiple current logo claims/entities | 9 | 1,397,530 | 2,109 ms |
| nike.com | first-party icon and wide | not needed | 12 | 1,023,391 | 1,722 ms |
| pepsi.com | no eligible first-party role | current preferred `Pepsi 2023.svg` selected as icon | 9 | 389,400 | 1,430 ms |

The pre-freeze control run also exposed a precision-aware Wikidata-time parsing
bug: year-precision values use `00` month/day. Fixing them as time intervals made
Pepsi's preferred 2023 claim correctly outrank an undated historical wordmark.

## Reproduction

```sh
node scripts/benchmark/benchmark.mjs --cohort major-brands-300 --split development \
  --output runs/wikimedia-fallback-2026-08-25/control-development \
  --concurrency 4 --timeout-ms 10000 --role-budget --content-bounding-wide
node scripts/benchmark/benchmark.mjs --cohort major-brands-300 --split development \
  --output runs/wikimedia-fallback-2026-08-25/treatment-development-v2 \
  --concurrency 4 --timeout-ms 10000 --role-budget --content-bounding-wide --wikimedia-fallback
node scripts/benchmark/benchmark.mjs --cohort major-brands-300 --split validation \
  --output runs/wikimedia-fallback-2026-08-25/control-validation \
  --concurrency 4 --timeout-ms 10000 --role-budget --content-bounding-wide
node scripts/benchmark/benchmark.mjs --cohort major-brands-300 --split validation \
  --output runs/wikimedia-fallback-2026-08-25/treatment-validation \
  --concurrency 4 --timeout-ms 10000 --role-budget --content-bounding-wide --wikimedia-fallback
node scripts/experiments/wikimedia-fallback-report.mjs \
  --control runs/wikimedia-fallback-2026-08-25/control-development \
  --treatment runs/wikimedia-fallback-2026-08-25/treatment-development-v2 \
  --reviews reports/wikimedia-fallback-2026-08-25/delta-reviews.jsonl \
  --split development --output reports/wikimedia-fallback-2026-08-25/development.json
npm run check
```

The compact reports preserve hashes for the frozen split, control/treatment
results, and delta review. Raw assets and captures remain under ignored `runs/`.

## Remaining risks

- P856 is community-maintained and can still identify a business unit that uses
  an apex domain; exact-domain agreement is strong evidence, not an ownership proof.
- Multiple legitimate current light/dark P154 variants currently cause
  abstention unless first-party extraction already satisfies the role.
- The in-process cache is bounded but not durable across serverless instances.
- Unreachable homepages still fail before the fallback stage; expanding recovery
  to unreachable sites requires a separate reachability-policy experiment.
- A second independent visual review and a larger validation admission set are
  needed before enabling the option by default.

## Independent operational-cost iteration

A follow-up review retained the opt-in decision and added a conservative
identity refinement: among exact-domain P856 matches, product paths are rejected
while a root, locale, or conventional corporate path remains identity evidence.
This resolves Google Search for `google.com`; Apple Inc. becomes the sole entity
match but still abstains because its multiple current P154 files are ambiguous
and neither is suitable for the missing wide role. No entity-type, name-only, or
company-specific tie-break was added.

The first cost experiment tried a single label search and eight entity results.
Development exposed an unsafe Amazon admission because the smaller search union
hid a second exact-domain entity, so that optimization was rejected before
validation. The frozen v4 treatment keeps two searches and twelve candidates.
It instead bounds the shared cache to 32 MiB, isolates injected transports by
default, coalesces concurrent identical requests, applies a five-second overall
resolver deadline, retries one 429/503/maxlag response without caching it, and
skips the asset-body request when declared Commons dimensions cannot satisfy an
icon-only gap. Commons results without usable license evidence are rejected;
redirect, page ID, canonical filename, license, and trademark provenance are
preserved. The CLI/programmatic cache TTL is now plumbed through explicitly.

| Split | Correct icon | Correct wide | Strict precision | Wrong/related | Selection change vs prior |
| --- | ---: | ---: | ---: | ---: | --- |
| Development v4 (180) | 0 | 22 | 22/22 (100%) | 0 | +1 Anthropic wide |
| Validation v4 (60) | 0 | 3 | 3/3 (100%) | 0 | none |

Fallback-local instrumentation measured 235 requests, 25,909,729 bytes, and
50,294 ms across 57 development attempts; validation measured 80 requests,
9,078,887 bytes, and 17,912 ms across 21 attempts. Compared with the prior
request accounting (232 development, 82 validation), development added three
requests while admitting Anthropic and validation removed two. The deterministic
declared-dimension gate avoids three known asset downloads (Cisco in development;
BlackRock and Subway in validation), totaling 12,031 bytes, without changing a
selection. Live reachability and upstream response changes make aggregate byte
and latency comparisons across independent runs directional rather than paired.

Post-freeze controls selected `Google Search 2026.svg` as the missing Google wide
role (five fallback requests); Apple abstained on multiple current P154 claims
(three); Nike needed no fallback; Pepsi validated a current logo but correctly
left the missing wide role null. The fallback therefore remains opt-in.

```sh
node scripts/benchmark/benchmark.mjs --cohort major-brands-300 --split development \
  --output runs/wikimedia-fallback-2026-08-25/treatment-development-cost-v4 \
  --concurrency 4 --timeout-ms 10000 --role-budget --content-bounding-wide --wikimedia-fallback
node scripts/benchmark/benchmark.mjs --cohort major-brands-300 --split validation \
  --output runs/wikimedia-fallback-2026-08-25/treatment-validation-cost-v4 \
  --concurrency 4 --timeout-ms 10000 --role-budget --content-bounding-wide --wikimedia-fallback
npm run check
```

## Claude Opus 5 independent review

A read-only Claude Code MCP review of commits `017d0fa` and `e53fcd6`
reproduced a high-severity identity bug: an exact-domain entity without a usable
P154 claim was discarded before entity ambiguity was evaluated. That allowed a
second exact-domain product/service entity with a logo to appear uniquely
identified. Identity matching now includes every exact-domain entity and must be
unique before logo availability, rank, role, or usability is considered.

The review also demonstrated that the 12-candidate slice could hide a rival at
the end of the two-search union. The resolver now examines the complete bounded
20-result union and records whether truncation occurred. Additional fixes enforce
one deadline across response headers and body reads, honor both delta-seconds and
HTTP-date `Retry-After` values when the delay fits the remaining budget, isolate
caller caches from global in-flight requests, bound the shared cache by estimated
retained size and entry count, preserve first-party records for byte-identical
Commons assets, source-gate Wikidata ranking evidence, restore a versioned User
Agent, and make validation/admission and Commons rejection diagnostics explicit.

Development was rerun before validation. Four previously correct selections
(Duolingo, Ryanair, Vimeo, and Netflix) now conservatively abstain because each
has distinct company/service entities carrying the same root-domain P856. This
is an intentional recall reduction: logo availability cannot resolve identity
ambiguity. Validation was then run unchanged.

| Split | Correct icon | Correct wide | Strict precision | Wrong/related | Change vs v4 |
| --- | ---: | ---: | ---: | ---: | --- |
| Development Opus v5 (180) | 0 | 18 | 18/18 (100%) | 0 | four conservative abstentions |
| Validation Opus v5 (60) | 0 | 3 | 3/3 (100%) | 0 | none |

Fallback-local totals were 223 requests and 26,159,119 bytes across 56
development attempts, and 75 requests and 8,241,515 bytes across 20 validation
attempts. Independent live runs remain subject to homepage reachability and
upstream-response drift. The precision result and new abstentions reinforce the
decision to keep the fallback opt-in.

```sh
node scripts/benchmark/benchmark.mjs --cohort major-brands-300 --split development \
  --output runs/wikimedia-fallback-2026-08-25/treatment-development-opus-v5 \
  --concurrency 4 --timeout-ms 10000 --role-budget --content-bounding-wide --wikimedia-fallback
node scripts/benchmark/benchmark.mjs --cohort major-brands-300 --split validation \
  --output runs/wikimedia-fallback-2026-08-25/treatment-validation-opus-v5 \
  --concurrency 4 --timeout-ms 10000 --role-budget --content-bounding-wide --wikimedia-fallback
npm run check
```
