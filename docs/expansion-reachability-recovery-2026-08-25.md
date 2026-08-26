# Expansion reachability recovery — 2026-08-25

## Decision

Promote the bounded homepage-recovery change. It improves development and
validation reachability while cutting the timeout tail, keeps the existing
request and byte ceilings, and does not admit weak logo roles from a recovered
blocked page.

No evaluation labels or evaluation run was opened for this decision. The
implementation was chosen from stored development diagnostics, rerun on the
180 development assignments, and then confirmed once on the 60 validation
assignments. Frozen benchmark artifacts were not modified.

## Stored expansion diagnosis

The stored 300-company run has 227 reachable companies and 73 homepage capture
failures. Its published taxonomy records 48 blocked interstitials, 24 unknown
failures, and one DNS/TLS failure. Parsing the stored failure messages without
using labels gives a more actionable operational taxonomy:

| Homepage failure class | Count | p50 | p95 | Evidence |
| --- | ---: | ---: | ---: | --- |
| Blocked HTTP / transport ending blocked | 51 | 715 ms | 10,589 ms | Mostly repeated 403; also 401, 418, 429, and 444 |
| Multi-attempt timeout | 18 | 30,005 ms | 30,020 ms | 17 timeout→timeout→timeout; one timeout→transport→timeout |
| Repeated HTTP 404 | 3 | 962 ms | 1,172 ms | All three homepage variants returned 404 |
| DNS/TLS | 1 | 9 ms | 9 ms | Bare and `www` DNS failure; HTTP repeated the bare-host lookup |

All 73 failures occurred during homepage acquisition. The latency tail was not
candidate validation: the 217 live-HTML successes had a 2,983 ms p95. The ten
off-domain redirect successes had a 10,677 ms p95; nine completed on the first
homepage attempt and one paid a primary timeout before recovering. The overall
30,003 ms p95 came from sequentially paying the 10-second timeout across bare
HTTPS, bare HTTP, and `www` HTTPS.

Development contained successful counterexamples to an immediate abort: three
sites recovered after a primary timeout and five recovered after an initial
403. Current probes showed the successful alternate-host response headers
arrived in under one second, while persistent timeout hosts exhausted every
variant. That evidence ruled out both blanket retries and stopping after the
first failure.

## Implementation

- Keep at most three homepage variants, but try alternate-host HTTPS before the
  legacy bare-host HTTP compatibility path.
- Keep the configured timeout for the primary request and cap fallback
  attempts at 3,000 ms.
- Stop after two consecutive homepage timeouts.
- Skip a later same-host attempt after that hostname has already failed DNS;
  TLS remains protocol-specific and may still use the existing HTTP
  compatibility path.
- Retain the existing five-redirect limit and public-URL validation on every
  redirect. Redirect recovery therefore stays bounded and does not broaden
  network access.
- Classify blocked status codes and security interstitial content explicitly.
  Repeated blocked responses retain the existing third compatibility attempt
  because development contained real recoveries there.
- On a page recovered after a blocked response, assign logo roles only to
  declared icons, structured/official assets, or candidates with explicit
  logo or home-link evidence. Weak navigation/body imagery remains visible in
  diagnostics but cannot become an icon or wide selection.
- Persist failure stage, failure class, timeout source, request count, bytes,
  and per-attempt outcomes instead of replacing failures with empty
  diagnostics.

The candidate download cap (16), per-image cap (3 MiB), homepage cap (2 MiB),
redirect cap (5), and public-network validation are unchanged.

## Results

The comparison baseline is the stored current-main
`major-brands-embedded-logo-fix` run. Reruns used concurrency 8 and no reviewer
labels.

| Split | Assigned / reachable before | Assigned / reachable after | p50 before → after | p95 before → after | Requests / reachable before → after | Bytes / reachable before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Development | 180 / 130 | 180 / 132 | 1,004 → 1,063 ms | 20,210 → 13,002 ms | 15.92 → 15.95 | 1.48 → 1.47 MB |
| Validation | 60 / 47 | 60 / 48 | 1,287 → 1,459 ms | 30,011 → 13,006 ms | 16.83 → 16.90 | 1.36 → 1.17 MB |

Development gained three reachable sites and lost one to live-site blocking,
for a net gain of two. Validation gained one reachable site. Development icon
and wide availability changed from 120/81 to 121/83; validation changed from
41/30 to 42/29. The two validation wide losses were primary-request successes
whose live markup changed (Oxford and UBS), not fallback-recovery decisions.

Recovered selections were audited without labels. Development recoveries kept
Lufthansa's declared icon and explicit header logo, Safran's favicon and
home-linked header logo, and Warby Parker's declared Apple icon. Validation
recovered UNICEF's declared favicon and explicit home-linked header logo. An
Under Armour fallback page exposed product photography as weak navigation
imagery; the recovery safety gate left it unselected and preserved the failure
instead of reporting a low-precision success.

Other selection differences on sites reached by the primary request were live
content drift: Epic Games and Nvidia changed rotating/icon content, BMW exposed
a new wide candidate, Allianz changed its logo asset, and Oxford/UBS lost a
wide candidate. The recovery policy does not run its evidence restriction for
primary-request successes.

## Limits

- These are live reruns against a stored baseline, so reachability and markup
  drift are confounders. The consistent timeout-tail reduction on both splits
  is directly explained by the new 10s + 3s bound; individual site gains and
  losses are less stable.
- p50 rose by 59 ms on development and 172 ms on validation. The change targets
  failure tails, not median latency.
- The final 60-company confirmation is small: its p95 is the third-slowest
  observation. A later synchronized control/candidate crawl would produce
  tighter confidence intervals.
- No evaluation run or evaluation labels were used. The change therefore does
  not claim a new 300-company quality score or evaluation result.

## Reproduction

```sh
npm run benchmark -- \
  --cohort major-brands-300 \
  --split development \
  --output runs/expansion-reachability-development-final-2026-08-25 \
  --concurrency 8 \
  --compare-run /Users/hendrik/Documents/logo-yoink/runs/major-brands-embedded-logo-fix/development

npm run benchmark -- \
  --cohort major-brands-300 \
  --split validation \
  --output runs/expansion-reachability-validation-2026-08-25 \
  --concurrency 8 \
  --compare-run /Users/hendrik/Documents/logo-yoink/runs/major-brands-embedded-logo-fix/validation
```

The new `--split` option intentionally accepts only `development` and
`validation` for this cohort; it rejects evaluation.
