# Major brands 300 stage 3 score — 2026-08-24

Stage 3 scored the frozen stage-2 run at `runs/2026-08-24-major-brands-300-stage-2/`.
The run is a 300-entity `major-brands-300` cohort. The follow-up scoring adapter
now makes every selected icon/wide slot explicit, so the authoritative canonical
result is a complete `50.62/100` score.

## Inputs and versions

| Item | Value |
| --- | --- |
| Stage-3 repository commit | `bf1f7c87fea68ff2747f88a406c9ec9247e51641` |
| Follow-up scoring implementation commit | `e3fe73b66af401257871f042a85333199b1aad7f` |
| Capture/ranking input commit | `3d07aca74f8d37f85bf0d6d54a6d4f1969bb53ef` |
| Fixture | `fixtures/companies-800.json` (`98e365f137966e3b1b8d8cff2a45765d71fe4fbbf64f90bc0502b51064f5be2c`) |
| Runtime schema | benchmark schema v2 |
| Runtime ranking | v5; canonical roles `icon`, `wide`; `favicon` compatibility-only |
| Label schema/workflow | `visual-benchmark-v1`; `visual-label-sheets-v3-candidate-only` |
| Label namespace | `visual-review-packet-v2` |

The key run-file SHA-256 values are recorded here for reproducibility:

```text
config.json                    d82d92a22ae39f220c3d823aaa084fa7ff5e2f19b81cc44b399d9ce20df02b50
results.jsonl                  4184d924fbb81ba5b2f2216b802964c1e790ee8b7ff756dc57766f80210c1a22
candidate-labels.jsonl         e9e58cc9866af47184b3d8d17748ac6f01dd8d6b37a8e04ca260735a3b409429
scoring-labels-adapter.jsonl   fb934396b8958902d5cb72913933a7c9623acaf8a9a244e29f82f92387e48c64
label-responses/primary.jsonl  991dd074478bd2aa3d8d913fcac0b88aa0eed9d57eea64657be7f8925b20d885
scoring-labels-selected-slots.jsonl  4fd7b3214a74b66dff3c362e154cb289a3460ac8356702221b350114698af2ac
```

## Contract decision and adapter

The canonical candidate label contract stores candidate identity and applicable
roles; it does not store a separate false value for every non-applicable role.
The candidate-only workflow documents this distinction explicitly: a selected
non-logo or a logo without the selected role must not be coerced into an `icon`
or `wide` candidate label, and final integration should adjudicate the selected
slot separately. The scorer's existing completeness test confirmed why: its
flat adapter only created a role key when the candidate label listed that role,
so exhaustive candidate review still left selected slots absent.

`scripts/benchmark/selected-role-scoring-adapter.mjs` is that derived slot
adjudication. It preserves source `identity` and applicable `roles`, then emits
`review_role` and explicit `correct: true|false` records for every persisted
selected icon/wide slot. A role mismatch is `correct: false` without changing
identity to `wrong`, so it cannot become a wrong-brand safety error merely from
being the wrong role. A reviewed `wrong` identity remains a wrong-brand false.

The ranker contract and tests define a favicon-family candidate as a canonical
icon fallback when no true icon candidate qualifies. All 11 favicon-only icon
pointers meet that condition, are reviewed correct favicon labels, and are
therefore emitted as `correct: true` canonical icon fallback adjudications.

## Coverage and failure accounting

| Outcome | Count | Cohort rate |
| --- | ---: | ---: |
| Total entities | 300 | 100.00% |
| Successful captures and fully candidate-labeled entities | 227 | 75.67% |
| `live_html` | 217 | 72.33% |
| `redirected_off_domain` (reachable by scorer) | 10 | 3.33% |
| `blocked_interstitial` | 48 | 16.00% |
| `unknown_failure` | 24 | 8.00% |
| `dns_tls_failure` | 1 | 0.33% |

The 73 blocked/unreachable entities have no invented candidate labels. They are
kept separate from logo discovery and selection failures on the 227 reachable
entities.

| Canonical role result | Captured denominator | Whole-cohort denominator |
| --- | ---: | ---: |
| Extracted icon candidate | 209/227 (92.07%) | 209/300 (69.67%) |
| Extracted wide candidate | 148/227 (65.20%) | 148/300 (49.33%) |
| Reviewer-positive icon candidate in source labels | 197/227 (86.78%) | 197/300 (65.67%) |
| Reviewer-positive wide candidate in set | 78/227 (34.36%) | 78/300 (26.00%) |
| Effective canonical icon candidate set (including 11 favicon fallbacks) | 208/227 (91.63%) | 208/300 (69.33%) |

Thus the final canonical whole-cohort candidate-set coverage, using the
reviewer-positive labels plus canonical icon fallback semantics and counting
capture failures as unavailable, is 69.33% for icon and 26.00% for wide. The
unreviewed automated availability proxy remains 59.5/100 (50% extracted icon
coverage + 50% extracted wide coverage, all-300 denominator).

## Canonical labeled score

The canonical score formula is coverage 30 + top-1 correctness 30 + visual
usability 20 + wrong-brand safety 10 + efficiency 10. The scorer uses the 227
reachable entities as the per-role quality denominator.

| Component | Observed points | Maximum | Notes |
| --- | ---: | ---: | --- |
| Candidate-set coverage | 18.90 | 30 | icon 208/227; wide 78/227 |
| Top-1 correctness | 15.93 | 30 | icon 176/227; wide 65/227 |
| Top-1 visual usability | 10.62 | 20 | all 241 correct selected slots were usable |
| Wrong-brand safety | 0.00 | 10 | 103/227 wrong-brand domains; 45.37% |
| Efficiency | 5.18 | 10 | p95 latency 30,003 ms; mean 16.4 requests; mean 1,447,997 bytes |
| **Final canonical score** | **50.62** | **100** | complete |

The 176/227 icon and 65/227 wide top-1 figures use all 368 explicit selected
slot adjudications. Of those slots, 230 were direct reviewed role matches, 11
were canonical icon favicon fallbacks, and 127 were explicit false judgments;
the 127 false slots were all reviewed wrong-identity candidates in this run.

The run has 2,732 candidate records and 2,732 expanded labels: 875 positive and
1,857 negative labels, with no uncertain labels. The scoring adapter emits 3,100
records (2,732 candidate records plus 368 slot adjudications), 1,655 flattened
role labels, and complete selected-slot coverage: 368/368 (220 icon, 148 wide).

## Output audit

- Canonical label validation: 0 errors; all 2,732 candidate IDs covered exactly once.
- Duplicate label IDs: 0; duplicate target keys: 0; duplicate response sheet IDs: 0.
- Unknown or cross-entity label candidate IDs: 0; unknown label entities: 0.
- Unsafe positive labels: 0. No positive label crossed entity ownership or lacked a valid role/usability judgment.
- Selected-slot adapter audit: 368 unique selected slots, 241 explicit true and 127 explicit false; no duplicate slot keys, missing source labels, or cross-entity references.
- The 11 persisted `selected_by_role.icon` pointers that reference candidates predicted only as `favicon` (Palo Alto Networks, ExxonMobil, John Deere, UnitedHealth Group, Thermo Fisher Scientific, Illumina, Valve, Zalando, United Nations, Cambridge University, and Alibaba) are valid canonical fallbacks under the ranker contract: each entity has no predicted icon candidate and the reviewed favicon is correct.
- No train/development/validation/evaluation split is attached to this 300-entity run, so split-leakage analysis is not applicable. The run is a single cohort capture and label pass.

The minimal provisioned run does not include the stage-2 `label-sheets-v3/`
packet directory, so the original PNG/fingerprint packet validator could not
be rerun here. The expanded labels, response shapes, IDs, ownership, and
provenance were independently checked from the retained JSONL files.
The adapter additionally requires exhaustive candidate-label coverage and exact
selected-slot coverage before writing output.

## Validation and exact scoring commands

Dependencies were installed from the lockfile with `npm ci --ignore-scripts`.
These commands passed unless noted:

```sh
npm run fixtures:validate
npm run check:syntax
npm run smoke
node --test test/benchmark.test.mjs test/company-fixtures.test.mjs \
  test/visual-label-sheets.test.mjs test/visual-benchmark-schema.test.mjs \
  test/visual-benchmark-agreement.test.mjs test/visual-benchmark-replay.test.mjs \
  test/visual-capture.test.mjs
npm test
```

The follow-up targeted suite passed 42/42 tests. The full suite passed 207/208;
the one pre-existing failure is `test/visual-capture.test.mjs`, which asks the
pilot fixture for the removed `all-500` cohort.

The stage-2 report's schema-native label command was also run exactly; it
returned `incomplete review 0/368` because that file stores labels under
`values`. The selected-slot adapter and repository scorer were then run:

```sh
node scripts/benchmark/selected-role-scoring-adapter.mjs \
  --run runs/2026-08-24-major-brands-300-stage-2 \
  --labels labels/major-brands-300-candidate-labels-v3-2026-08-24.jsonl \
  --output runs/2026-08-24-major-brands-300-stage-2/scoring-labels-selected-slots.jsonl

npm run benchmark -- score \
  --run runs/2026-08-24-major-brands-300-stage-2 \
  --labels runs/2026-08-24-major-brands-300-stage-2/scoring-labels-selected-slots.jsonl \
  --output runs/2026-08-24-major-brands-300-stage-2/summary-labeled-stage3-final.json
```

The scorer returns `benchmark score 50.62/100` and
`selected_roles_labeled: 368/368`; generated adapter and summary files remain
in the ignored `runs/` directory.

## Comparison limits

The existing StartupSeeker/500-company result is descriptive context only, not
a directly comparable quality score. Its published availability proxy weights
icon/wide/favicon as 40%/40%/20%, while this run's canonical proxy uses only
icon/wide at 50%/50%. More importantly, the frozen 500 benchmark captured
ranking version 3, while this run uses ranking version 5; the repository's
qualification file explicitly says the captured v3 metrics do not qualify the
current runtime. The cohorts, capture protocol, and quality-label completeness
also differ. Therefore no cross-run ranking claim is made. The historical
500-run figures (365/500 icon, 249/500 wide, 354/500 favicon) are not placed in
the stage-3 metric table.

## Reproduction

Checkout `e3fe73b66af401257871f042a85333199b1aad7f`, provision the ignored run
directory, install from `package-lock.json`, and rerun the validation and score
commands above. Verify all input hashes with:

```sh
sha256sum fixtures/companies-800.json package-lock.json \
  runs/2026-08-24-major-brands-300-stage-2/{config.json,results.jsonl,candidate-labels.jsonl,scoring-labels-adapter.jsonl,scoring-labels-selected-slots.jsonl,label-responses/primary.jsonl}
```
