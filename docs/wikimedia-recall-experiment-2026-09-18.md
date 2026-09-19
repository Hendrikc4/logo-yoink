# Wikimedia recall experiments — 2026-09-18

## Outcome

Across 40 currently missing-library companies, the resolver found a Commons logo for **23 instead of 18** (+5, or 12.5 percentage points). Three additional files passed both the existing image validator and light-theme role ranking. These are discovery/validation results, not additions to the approved brand library or a frozen-benchmark qualification claim.

| Cohort | Original resolver | Improved resolver |
| --- | ---: | ---: |
| Google Images pilot: first 20 missing companies | 10/20 | 12/20 |
| Separate 20 missing companies | 8/20 | 11/20 |
| Combined | 18/40 | 23/40 |

The indexed-website-search-only experiment improved the first cohort to 11/20. Recognizing default homepage documents brought it to 12/20.

| New discovery | Image validation | Light-theme role ranking |
| --- | --- | --- |
| Best Buy | Pass | No role; stacked-logo restriction |
| Marriott | Pass | Wide |
| Singapore Airlines | Pass | Wide |
| Schneider Electric | Pass | Wide |
| Berkshire Hathaway | Reject | Not eligible |

The four validated files were visually reviewed on white contact sheets. No ranking or SVG-validation restrictions were relaxed. Six of the seven logos recovered by the earlier Google Images pilot already resolved with the original Wikimedia lookup: missing library art often reflects downstream validation, role selection, timeout, or manual review rather than failed Wikimedia discovery.

## Implementation

- Keep existing domain/name searches, but run their independent requests concurrently under the same deadline.
- If those searches produce **no verified official-site match**, search Wikidata's indexed P856 official-website statements. This handles joined domain labels such as `bestbuy` that do not match entity names.
- Verify every search hit against the existing current P856 identity rules. Prefix search is discovery evidence only; product paths and lookalike domains cannot prove identity.
- Recognize single default homepage documents such as Marriott's `/default.mi`.
- Tighten locale recognition to ISO 639-1 language tags, excluding accidental `app`, `api`, and `tv` matches.
- Fail closed on truncated searches, malformed hits, missing entity records, and identity rivals even when a rival lacks a logo. Explicit API redirects are accepted as records, not used to silently discard rivals.
- Preserve current/preferred P154 selection, Commons provenance, image validation, and role-ranking rules.

The website query uses URL-prefix `haswbstatement` syntax documented by [WikibaseCirrusSearch](https://www.mediawiki.org/wiki/Help:Extension:WikibaseCirrusSearch) and [its URL-prefix search implementation](https://phabricator.wikimedia.org/T243693).

## Limits and cost

The paired discovery runs used a 10-second resolver budget and captured API responses; final-code replay reproduced the gains with zero live API calls. Replay still performs public DNS safety checks. It is not a latency benchmark.

At the unchanged production default of five seconds, a separate cold live run recovered four of the five new candidates; Schneider Electric timed out. Parallel name search lowered observed latency for the other four versus an earlier serial run, but these were separate live runs, not a controlled timing comparison. Do not promise all five gains on cold production requests.

Across the 40 companies, API requests increased from 130 to 158 and JSON response bytes from 16,017,156 to 17,614,287. Successful original name lookups do not incur the additional website-search stage. The fallback does not exhaust all possible subdomain-only website statements or fix downstream image/role failures.

Five additional controls retained their previous results: Apple abstained for ambiguous logos, Amazon abstained for ambiguous entities, and Google, Nike, and Pepsi resolved. These small cohorts are exploratory, not a representative precision audit of all 1,000 companies.

## Reproduction and artifacts

Baseline source: commit `b6c214bab5a805d22c656a628a897318e6a531fd`, resolver SHA-256 `8a5c23fc8244b5286851e50b62f13aa27fc1efe143b550e6d5ab450657eab634`.

Final resolver SHA-256: `812296924dfbb5bd6595a8ecb312834ff6bc012eb320de481b7bd30c5ceaaf29`.

Local research artifacts are in ignored `runs/wikimedia-recall-2026-09-18/`. They include `baseline.json`, `development-final-replay.json`, `validation-baseline.json`, `validation-final-replay.json`, response captures, cold-five-second reports, and `development-assets/` / `validation-assets/` results and review sheets. These artifacts are not committed fixtures.

Replay the development cohort using its existing capture:

```sh
node scripts/experiments/wikimedia-recall.mjs --offline --responses runs/wikimedia-recall-2026-09-18/responses.json --output runs/wikimedia-recall-2026-09-18/replay.json
```

For fresh paired captures, omit `--offline`; use `--revision b6c214bab5a805d22c656a628a897318e6a531fd` for the original resolver, then omit `--revision` for the working-tree treatment, sharing the same response capture. Use a new capture path for genuinely cold API timing and `--timeout-ms 5000` for the production deadline. Reports include source hashes and request accounting.

The separate cohort and controls can be selected with:

```text
--domains emirates.com,singaporeair.com,abb.com,se.com,3m.com,bankofamerica.com,berkshirehathaway.com,nytimes.com,bbc.com,reuters.com,ea.com,lufthansa.com,alibabagroup.com,rappi.com,verizon.com,mckinsey.com,pwc.com,palantir.com,bumble.com,shein.com,apple.com,amazon.com,google.com,nike.com,pepsi.com
```

Validate and render only newly discovered files with:

```sh
node scripts/experiments/wikimedia-recall-assets.mjs --control runs/wikimedia-recall-2026-09-18/baseline.json --treatment runs/wikimedia-recall-2026-09-18/development-final-replay.json --output runs/wikimedia-recall-2026-09-18/review-repeat
```

`npm run check` passed: 437 tests, syntax checks, fixture validation, local smoke test, both library verifiers, and library self-tests. Eight resolver tests were added for indexed discovery, identity ambiguity, response completeness/truncation, homepage scope, current-logo selection, malformed payloads, concurrent requests, and explicit redirects. The 1,000-company library remains unchanged at 979 approved assets.
