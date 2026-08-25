# major-brands-300 stage 2 run — 2026-08-24

Run directory: `runs/2026-08-24-major-brands-300-stage-2/`

The run started from dataset commit `3d07aca74f8d37f85bf0d6d54a6d4f1969bb53ef` and used the lockfile dependencies, extractor concurrency 4, and a 10,000 ms per-request timeout. Raw results, failures, and content-addressed assets are retained in the ignored run directory.

## Coverage

| Measure | Count |
| --- | ---: |
| Cohort entities | 300 |
| Successful extraction rows | 227 |
| Labelable companies | 227 |
| Candidate records | 2,732 |
| Numbered sheets | 168 |
| Expanded primary labels | 2,732 |
| Positive labels | 875 |
| Negative labels | 1,857 |
| Uncertain labels | 0 |

Reachability outcomes: 217 `live_html`, 10 `redirected_off_domain`, 48 `blocked_interstitial`, 24 `unknown_failure`, and 1 `dns_tls_failure`. No labels were invented for the 73 entities without a successful candidate scrape; those are recorded as capture abstentions in the packet index and failures CSV.

## Label packet

The frozen packet is `runs/2026-08-24-major-brands-300-stage-2/label-sheets-v3/`. Primary responses are in `runs/2026-08-24-major-brands-300-stage-2/label-responses/primary.jsonl`, and the validated expanded output is `runs/2026-08-24-major-brands-300-stage-2/candidate-labels.jsonl`. The validator accepted all 168 sheet fingerprints, exact sheet coverage, and one expanded label per captured candidate.

## Verification

- `npm run fixtures:validate` — passed.
- `npm run check:syntax` — passed.
- Relevant benchmark/label tests — 23 passed.
- Full `npm test` — one pre-existing failure: `test/visual-capture.test.mjs` expects `all-500` in the pilot fixture, which contains no such cohort; 205 tests passed.

Stage 3 scoring command:

```sh
npm run benchmark -- score --run runs/2026-08-24-major-brands-300-stage-2 --labels runs/2026-08-24-major-brands-300-stage-2/candidate-labels.jsonl --output runs/2026-08-24-major-brands-300-stage-2/summary-labeled.json
```
