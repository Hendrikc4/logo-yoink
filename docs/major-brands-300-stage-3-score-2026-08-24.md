# Major brands 300 stage 3 score — 2026-08-24

Stage 3 scored the frozen stage-2 run at `runs/2026-08-24-major-brands-300-stage-2/`.
The run is a 300-entity `major-brands-300` cohort. The scorer does not produce a
final 0–100 quality score because 230 of 368 selected role slots have a
role-specific label; its authoritative result is therefore `status: incomplete`,
`value: null`.

## Inputs and versions

| Item | Value |
| --- | --- |
| Stage-3 repository commit | `bf1f7c87fea68ff2747f88a406c9ec9247e51641` |
| Capture/ranking input commit | `3d07aca74f8d37f85bf0d6d54a6d4f1969bb53ef` |
| Fixture | `fixtures/companies-500.json` (`98e365f137966e3b1b8d8cff2a45765d71fe4fbbf64f90bc0502b51064f5be2c`) |
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
```

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
| Reviewer-positive icon candidate in set | 197/227 (86.78%) | 197/300 (65.67%) |
| Reviewer-positive wide candidate in set | 78/227 (34.36%) | 78/300 (26.00%) |

Thus the effective whole-cohort candidate-set coverage, using the reviewer
positive labels and counting capture failures as unavailable, is 65.67% for
icon and 26.00% for wide. The unreviewed automated availability proxy remains
59.5/100 (50% extracted icon coverage + 50% extracted wide coverage, all-300
denominator).

## Canonical labeled score

The canonical score formula is coverage 30 + top-1 correctness 30 + visual
usability 20 + wrong-brand safety 10 + efficiency 10. The scorer uses the 227
reachable entities as the per-role quality denominator.

| Component | Observed points | Maximum | Notes |
| --- | ---: | ---: | --- |
| Candidate-set coverage | 18.17 | 30 | icon 197/227; wide 78/227 |
| Top-1 correctness | 15.20 | 30 | icon 165/227; wide 65/227 |
| Top-1 visual usability | 10.13 | 20 | observed labeled correct selections were usable |
| Wrong-brand safety | 10.00 | 10 | provisional; 138 selected slots remain unlabeled |
| Efficiency | 5.18 | 10 | p95 latency 30,003 ms; mean 16.4 requests; mean 1,447,997 bytes |
| Observed component sum | 58.68 | 100 | not a final score |

The 165/227 icon and 65/227 wide top-1 figures are conservative whole-captured-
entity rates: an unlabeled selected role does not count as correct. Among the
230 selected role slots that did receive a role-specific label, all were labeled
identity-correct and usable; this conditional result must not be interpreted as
complete selected-asset precision.

The run has 2,732 candidate records and 2,732 expanded labels: 875 positive and
1,857 negative labels, with no uncertain labels. There are 368 selected slots
(220 icon, 148 wide), of which 230 are role-labeled (165 icon, 65 wide).

## Output audit

- Canonical label validation: 0 errors; all 2,732 candidate IDs covered exactly once.
- Duplicate label IDs: 0; duplicate target keys: 0; duplicate response sheet IDs: 0.
- Unknown or cross-entity label candidate IDs: 0; unknown label entities: 0.
- Unsafe positive labels: 0. No positive label crossed entity ownership or lacked a valid role/usability judgment.
- Selection consistency issue: 11 persisted `selected_by_role.icon` pointers reference candidates predicted only as `favicon` (Palo Alto Networks, ExxonMobil, John Deere, UnitedHealth Group, Thermo Fisher Scientific, Illumina, Valve, Zalando, United Nations, Cambridge University, and Alibaba). These are not valid icon-role selections in this audit; the raw scorer still mechanically includes the persisted pointers in its 220 icon-slot count, so this is another reason not to claim a complete score.
- No train/development/validation/evaluation split is attached to this 300-entity run, so split-leakage analysis is not applicable. The run is a single cohort capture and label pass.

The minimal provisioned run does not include the stage-2 `label-sheets-v3/`
packet directory, so the original PNG/fingerprint packet validator could not
be rerun here. The expanded labels, response shapes, IDs, ownership, and
provenance were independently checked from the retained JSONL files.

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

The targeted suite passed 60/61 tests and the full suite passed 205/206. The
single failure is pre-existing: `test/visual-capture.test.mjs` asks the pilot
fixture for the removed `all-500` cohort.

The stage-2 report's schema-native label command was also run exactly; it
returned `incomplete review 0/368` because that file stores labels under
`values`. The repository scorer's flat-label adapter was then run:

```sh
npm run benchmark -- score \
  --run runs/2026-08-24-major-brands-300-stage-2 \
  --labels runs/2026-08-24-major-brands-300-stage-2/candidate-labels.jsonl \
  --output runs/2026-08-24-major-brands-300-stage-2/summary-labeled-stage3-raw.json

npm run benchmark -- score \
  --run runs/2026-08-24-major-brands-300-stage-2 \
  --labels runs/2026-08-24-major-brands-300-stage-2/scoring-labels-adapter.jsonl \
  --output runs/2026-08-24-major-brands-300-stage-2/summary-labeled-stage3.json
```

The second command is the authoritative stage-3 scoring invocation and returns
`incomplete review 230/368 selected roles labeled`; its JSON output remains in
the ignored `runs/` directory.

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

Checkout `bf1f7c87fea68ff2747f88a406c9ec9247e51641`, provision the ignored run
directory, install from `package-lock.json`, and rerun the validation and score
commands above. Verify all input hashes with:

```sh
sha256sum fixtures/companies-500.json package-lock.json \
  runs/2026-08-24-major-brands-300-stage-2/{config.json,results.jsonl,candidate-labels.jsonl,scoring-labels-adapter.jsonl,label-responses/primary.jsonl}
```
