# Wikimedia cache and transport experiments — 2026-09-19

## Accepted changes

The resolver now discards unused claim properties and statement references **after parsing the bounded API response and before caching/cloning it**. P154/P856 statements retain their IDs, ranks, mainsnaks, and all qualifiers. Entity IDs, redirects, missing records, and malformed relevant data remain visible to the existing verification rules. This changes retained memory and repeat traffic, not discovery eligibility or downloaded cold-response bytes.

Host cooldowns now propagate HTTP 429/503 Retry-After and maxlag/ratelimited delays across production requests. A lookup with insufficient time remaining abstains before making another request. Cached results remain available, expired cooldowns recover, and a longer cooldown received during a wait is honored. Missing Retry-After uses 250ms; previously `Number(null)` inadvertently selected zero. Coalesced followers enforce their own deadlines without cancelling the original request.

Malformed name-search arrays/hits now fail closed instead of silently dropping potential identity rivals.

## Controlled cache ablation

The 37 previously exposed domains that the program's frozen inventory assigns to development were replayed in fixed order twice. Held-out and frozen-evaluation domains were excluded. The harness enables the unchanged production 32MiB / 256-entry cache with fixture transport; no network or DNS request occurs. Baseline is a preserved copy taken before these changes. Candidates, provenance, and final statuses match exactly across variants and passes.

| Metric | Baseline first pass | Treatment first pass | Baseline repeat | Treatment repeat |
| --- | ---: | ---: | ---: | ---: |
| Domains / discovered files | 37 / 21 | 37 / 21 | 37 / 21 | 37 / 21 |
| API requests needing transport | 146 | 146 | 146 | 0 |
| API response bytes | 18,744,539 | 18,744,539 | 18,744,539 | 0 |
| Final accounted cache bytes | 28,609,864 | 2,295,940 | 28,609,864 | 2,295,940 |
| Final cached entries | 67 | 146 | 67 | 146 |
| Total local replay time, ms | 530 | 209 | 488 | 8 |

The old cache evicted earlier requests before their next use; the projected cache retained the complete workload. Accounted bytes use the repository's existing four-times-serialized-size estimate and are **not measured process RSS**. Replay times are local parsing/cloning CPU observations, **not live latency promises**. Real cold download costs are unchanged. The 256-entry cap still limits larger working sets.

A separate seven-domain paired replay illustrates why this matters: Schneider Electric retained 9.46MB in the baseline cache versus 69KB after projection, with identical discovery/provenance. These are discovery candidates, not newly approved usable art.

## Live result and rejected experiments

A two-round seven-domain cold/warm attempt encountered HTTP rate limiting from the first request: 55 of 56 outcomes were rate-limited and one errored, with no API JSON bytes downloaded. It provides no valid cold latency or recall estimate. The research runner now stops at its first rate-limit outcome. No live gain is claimed. This finding motivated the shared production cooldown and the parent program's paced capture scheduler.

Current [Wikidata API parameter metadata](https://www.wikidata.org/w/api.php?action=paraminfo&modules=wbgetentities%7Cwbgetclaims&format=json) confirms that batched `wbgetentities` cannot filter claim properties. `wbgetclaims` can filter one entity/property and omit references, but requires request fanout to preserve the full candidate set. Extra fanout and speculative website-search requests were not promoted without live cost/latency evidence, especially given observed rate limiting. A speculative-overlap prototype remains an ignored research artifact, not production code.

## Fresh live observation after service recovery

At 2026-09-19 08:21 UTC, three development domains were each run once against baseline and treatment at the production five-second deadline, followed by one lookup using that variant's same cache. There was at least one second between lookup invocations. All twelve lookup outcomes completed without rate limiting. This is six cold observations and six repeats, not a statistically controlled latency benchmark: baseline always preceded treatment, and remote caches and network conditions were uncontrolled.

| Domain / phase | Baseline status / ms | Treatment status / ms | Requests, each variant | Downloaded bytes, each variant |
| --- | --- | --- | ---: | ---: |
| se.com cold | timeout / 5,003.58 | timeout / 5,000.52 | 5 | 2,020,139 |
| se.com repeat | discovered / 2,556.48 | discovered / 2,512.72 | 2 | 350,993 |
| lufthansa.com cold | discovered / 3,106.68 | discovered / 3,387.28 | 4 | 553,697 |
| lufthansa.com repeat | discovered / 8.02 | discovered / 0.85 | 0 | 0 |
| traton.com cold | discovered / 2,279.50 | discovered / 1,828.40 | 4 | 96,594 |
| traton.com repeat | discovered / 1.26 | discovered / 0.54 | 0 | 0 |

Both variants returned the same files: `Schneider Electric 2007.svg`, `Lufthansa Logo 2018.svg`, and `Traton Group logo.svg`. Schneider still misses the cold five-second deadline; its repeat reuses four completed API responses and needs two network requests. Thus its repeat is only partially warm. These results confirm functioning live discovery and cache reuse, not new usable-logo approvals or improved cold recall. Treatment was slower on Lufthansa's cold request, illustrating why no general cold-latency gain is claimed.

The source-hashed observation is `runs/missing-logo-program-2026-09-19/discovery/fresh-cold-warm.json`. Reproduce with:

```sh
node scripts/experiments/wikimedia-cost.mjs --mode live --rounds 1 --timeout-ms 5000 --spacing-ms 1000 --domains se.com,lufthansa.com,traton.com --output runs/missing-logo-program-2026-09-19/discovery/fresh-cold-warm.json
```

## Precision boundary

Name search remains a **bounded discovery mechanism**: at most ten results from each of two terms, followed by strict official-website and current-logo verification for every candidate in that union. Twenty-eight of these 37 domains had name-search continuation markers. Rejecting every continuation would dramatically change the existing candidate-recall boundary; this experiment does not make that change or claim global uniqueness beyond the inspected union. Indexed official-website search, when reached, still rejects truncated results. The earlier report's blanket description of truncation handling should be read with this distinction.

The accepted changes neither loosen identity/SSRF/asset-safety checks nor admit additional logos. They reduce repeated request cost, make rate-limit behavior cooperative, and preserve honest abstentions. Current-logo ambiguity, website aliases outside accepted scopes, and downstream role/asset rejection remain separate gaps.

## Reproduction and validation

```sh
node scripts/experiments/wikimedia-cache-capacity.mjs
node scripts/experiments/wikimedia-cost.mjs --mode replay
node --test test/wikimedia-fallback.test.mjs
```

Both scripts enforce development membership from `reports/missing-logo-program-2026-09-19/inventory.json`. The cost script accepts `--domains`, `--rounds`, `--baseline`, `--treatment`, `--timeout-ms`, `--spacing-ms`, `--mode live`, and `--output`. Live mode defaults to one second between lookups and stops on rate limiting; use a separate capture scheduler when sustained collection is needed.

Artifacts under ignored `runs/missing-logo-program-2026-09-19/discovery/` include the baseline source, source-hashed cache capacity report, seven-domain replay/live reports, endpoint parameter metadata, pagination audit, and focused test log. All 30 resolver tests pass, covering retained qualifiers, exact cold/warm equivalence, malformed name hits, host cooldown sharing/recovery/cache access, and independent coalesced caller deadlines.
