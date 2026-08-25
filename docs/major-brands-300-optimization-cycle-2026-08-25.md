# Major-brands-300 optimization cycle — 2026-08-25

> Historical stop decision, superseded after the requested full independent
> review completed. The missing 2,605-candidate audit described below now
> exists, the scorer's safety semantics are explicit, and ranking v6 passed
> development, validation, one-shot evaluation, and frozen-500 delta review.
> See [the independent-review and ranking-v6 report](major-brands-300-independent-review-and-ranking-v6-2026-08-25.md).

## Decision

Stop: no extraction, discovery, eligibility, or ranking change is promoted. The
retained bundle is a production no-op plus benchmark-only semantic fixes,
source-controlled split assignments, and audit artifacts. The new cohort's
adjudicated selected precision is `325/368 = 88.32%` with ambiguous counted as
non-correct, well below the `98%` gate. None of the isolated ranking vetoes
combined measurable development and validation gain with zero reviewed
regressions. The frozen 500 production-precision baseline remains exactly
`71.97/100`, `343` correct icons, `233` correct wides, and zero wrong-brand
domains.

There is no repository `AGENTS.md` in the worktree or saved checkout. The global
working agreements supplied with the task were followed.

## Baseline reproduction and provenance

The authoritative run was read in place at
`/Users/hendrik/Documents/logo-yoink/runs/2026-08-24-major-brands-300-stage-2`;
it was not modified. The current adapter regenerated 3,100 scoring rows with
SHA-256 `4fd7b3214a74b66dff3c362e154cb289a3460ac8356702221b350114698af2ac`,
byte-identical to the retained integration artifact. Scoring reproduced
`50.62/100` exactly:

| Component | Points | Evidence |
|---|---:|---|
| Coverage | 18.90 | icon 208/227; wide 78/227 |
| Top-1 | 15.93 | icon 176/227; wide 65/227 |
| Visual usability | 10.62 | copied from identity-coupled v3 labels |
| Wrong-brand safety | 0.00 | historical scorer reported 103/227 domains |
| Efficiency | 5.18 | p95 30,003 ms; 16.4 requests/domain; 1,447,997 bytes/domain |

The run contains exactly 300 unique entities, 2,732 candidates and unique
labels, 168 response sheets, and 368 selected slots (220 icon, 148 wide). Labels
contain 875 `correct`, 1,857 `wrong`, and zero `ambiguous` values. The adapter
derives 241 correct and 127 false selected slots; 230 are direct role matches
and 11 are canonical favicon-to-icon fallbacks. The 127 false slots span 103
domains (44 icon, 83 wide). All 168 packet PNG/fingerprint validations passed.

Key immutable input hashes are: config `d82d92a22ae39f220c3d823aaa084fa7ff5e2f19b81cc44b399d9ce20df02b50`,
results `4184d924fbb81ba5b2f2216b802964c1e790ee8b7ff756dc57766f80210c1a22`,
candidates `a3884b1a627e3a920978038b6bb008909d4fdaa6e2ca6fa46cc9b21bea7854cc`,
and tracked labels `e9e58cc9866af47184b3d8d17748ac6f01dd8d6b37a8e04ca260735a3b409429`.
The tracked fixture hash is
`98e365f137966e3b1b8d8cff2a45765d71fe4fbbf64f90bc0502b51064f5be2c`.

Two provenance defects remain historical facts: the retained `config.json`
incorrectly names `fixtures/companies-500.json` even though its ordered entities
exactly match the `companies-800.json` major-brand cohort, and the stage-3 report
names `scoring-labels-selected-slots.jsonl` while the retained byte-identical
file is suffixed `-integration`. The saved packet does contain all 168 PNGs,
contrary to the historical report. No frozen file was rewritten.

## Split and evaluation discipline

Before tuning, `scripts/benchmark/visual-benchmark-shards.mjs` created
`benchmarks/major-brands-300-v1` from only the 300 major-brand entities with seed
`logo-yoink-major-brands-300-v1`: 180 development, 60 validation, and 60
evaluation entities. The assignment digest is
`10e4e57e93dcf0b9c58a0fef773c763881a44d132bef23fce4a9bf8c454f8de9`.
The evaluation IDs were not inspected or scored during diagnosis/tuning.

After all promotion decisions were frozen, evaluation was opened once for the
retained control: 60 entities, 50 reachable, 48 icons, 35 wides, and zero
changed slots. It consumed no new network work because this was a frozen offline
replay. A selected-slot-adjudicated diagnostic over this split is `78.00/100`
(44/50 correct icons, 32/50 correct wides, zero true wrong-brand domains;
853 retained requests, 71,766,620 retained bytes, 10,677 ms p95). Like the
all-cohort 72.27 diagnostic below, it is not canonical because unselected v3
candidate negatives were not re-reviewed.

## Root-cause and label/scorer audit

The candidate-only prompt asks the reviewer to list only real logos. The response
importer maps every omitted tile to `identity=wrong`; the historical scorer then
interprets every `wrong` selected candidate as a wrong-brand safety event. All
875 positive labels are `good/good`, all 1,857 negatives are
`unusable/unusable`, and there are no uncertain or one-theme judgments. Five
responses claim zero logos across 80 candidates for DHL, Slack, Hugging Face,
Vodafone, Lowe's, and Verizon despite visible first-party marks. All 127
historical false selections are DOM candidates (123 `dom-img`, 4
`dom-picture`).

Every reported-false selected slot was re-reviewed against its frozen source
asset on white and dark backgrounds. The separate v1 adjudication artifact
(SHA-256 `b31b42e623feae327f83d9a6dcc7351e7058a0751dc6f529644743c40f92490e`)
preserves the original label ID and values, packet fingerprint, sheet/tile,
asset path, rationale, corrected identity/role, independent theme usability,
and reviewer provenance. It does not replace the v3 labels.

| Corrected class | Slots | Interpretation |
|---|---:|---|
| Same-brand logo false negative | 84 | 23 icon, 61 wide |
| Non-logo/content/UI | 29 | photos, campaign art, controls, or embedded UI |
| Related product/subbrand/co-brand | 11 | not the requested corporate identity |
| True foreign brand | 1 | GitLab selected HackerOne |
| Unjudgeable | 2 | BYD and Safaricom animated GIF previews froze blank |

The 84 same-brand rows are 42 good/good, 13 good/conditional, 14
unusable/good, 10 good/unusable, and 5 conditional/good. Applying these 127
overrides through the provenance-checking benchmark utility changes the
historical selected projection from 241 to 325 correct slots and reduces actual
wrong-brand domains from 103 to 1. The diagnostic score becomes `72.27/100`:
coverage 22.47, top-1 21.48, usability 13.59, safety 9.56, efficiency 5.18.

That 72.27 is an evaluation-repair diagnostic, not a new canonical score and not
a runtime gain. The other 2,605 candidate labels were not visually
re-adjudicated; therefore candidate-set coverage and the 86 successful but
unselected role slots cannot honestly be separated into discovery miss,
eligibility/filter miss, or icon-only/text-only. The all-domain taxonomy records
those as `unresolved_discovery_eligibility_or_brand_form`. Its defensible
prevalence is: 73 capture failures, 83 unresolved missing-role domains, 77 label
defects, 28 ranking misses, 11 role mismatches, 10 redirect/rebrand reviews, and
2 visual-usability issues. The ten off-domain redirects are coherent official,
regional, or owned-brand moves; none is harmful.

For future packets, the canonical label contract now carries `safety_class`.
The candidate-only importer stamps a positive as `correct_brand`, an uncertain
tile as `unjudgeable`, and an omitted tile as `unclassified_negative`. That last
class deliberately prevents an omission from becoming wrong-brand without
inventing whether it is a non-logo, related brand, or foreign brand. A separate
adjudication must supply `wrong_brand`, `related_brand`, or `not_logo` when the
distinction matters. This changes no frozen v3 label.

Quality scoring uses only the 227 reachable domains, excluding 73 capture
failures from coverage, correctness, and usability. Applying the same arithmetic
over all 300 would produce 39.56 under the defective labels. That value is also
noncanonical, but documents why 50.62 is not an end-to-end cohort score.

## Isolated experiments

All experiments reranked the same frozen candidates with one deterministic veto
at a time. They added zero requests, bytes, latency, browser invocations, or AI
calls; retained capture cost therefore stays 3,714 requests, 328,695,315 bytes,
and 30,003 ms p95. No icon/favicon movement was left unreviewed.

| Profile | Development | Validation | Visual decision | Negative taxonomy |
|---|---|---|---|---|
| Control | 0 changes | 0 changes | exact canonical icon/wide selections | retained no-op |
| Unlinked body/path agreement | 6 changes | 0 changes | removes four non-logo/foreign selections and fixes Intel, but wrongly withholds valid Heineken | precision-limited on development; validation zero-yield |
| Descriptive body raster | 4 changes | 2 changes | fixes Intel/Intuit and withholds BMW/Peloton content; validation removes Apple content but also valid Subway | precision-limited on validation |
| Foreign-named nav logo | 2 changes | 0 changes | fixes Coca-Cola, but swaps related Reclaim.ai for related Dropbox Sign | precision-limited; validation zero-yield |
| Combined precision | 11 changes | 2 changes | inherits valid Heineken and Subway losses plus unresolved Dropbox product swap | precision-limited |

All unique changed before/after assets were reviewed on both backgrounds. The
specific content/UI removals were Intel's McLaren photograph, Intuit's editorial
image, Target's campaign raster, Coca-Cola's careers image, BMW's vehicle hero,
Thermo Fisher's campaign hero, Tata's careers icon, Peloton's editorial card,
and Apple's iPhone hero. GitLab's HackerOne mark was the only true foreign-brand
removal. Intel, Intuit, and Coca-Cola moved to their correct first-party icons.
Heineken and Subway were valid same-brand wordmarks and make the broad vetoes
unshippable. Dropbox moved between two related product brands, not to the
requested corporate icon.

No experiment meets the required 98% strict precision, zero regression, zero new
wrong-brand, measurable development and validation gain, and no unreviewed role
movement gates. No evaluation treatment was run, and no production rule was
implemented.

## Frozen-500 protection and verification

The historical production-precision run at
`/Users/hendrik/Documents/logo-yoink/runs/review-final-all-500` plus tracked
`labels/review-500-final-2026-08-22.jsonl` reproduces `71.97/100` exactly:
423 reachable domains; 343/423 correct icon coverage and top-1; 233/423 correct
wide coverage and top-1; 0 wrong-brand domains; 5,859 requests; 507,833,072
bytes; 4,502 ms p95. The score artifact SHA-256 is
`75d397393716bb38f1f39784b6350d989a6258d400e655b738349b71bed0cf99`.

The independent frozen visual ranking-v3 baseline also reproduces every metric,
label hash, and all 1,155 selection slots: `55.47/90` (61.63% normalized). It is
explicitly not a qualification of current runtime ranking v5. Since the retained
bundle changes no production ranking or extraction code, there is no frozen-500
selection movement. The benchmark scorer retains its legacy identity fallback
when `safety_class` is absent, so historical artifacts reproduce unchanged.

## Reproduction and raw artifacts

```text
Authoritative read-only run:
  /Users/hendrik/Documents/logo-yoink/runs/2026-08-24-major-brands-300-stage-2

Ignored optimization artifacts:
  runs/2026-08-24-major-brands-300-optimization/
  runs/major-brands-cycle/{control,unlinked-body-path-agreement,descriptive-body-raster,foreign-named-nav-logo,combined-precision}-{development,validation}/
  runs/major-brands-cycle/control-evaluation/
  runs/2026-08-25-frozen-500-production-precision-replay.json
  runs/2026-08-25-frozen-500-baseline-replay.json

Tracked evidence:
  reports/major-brands-300-optimization-2026-08-25/
  benchmarks/major-brands-300-v1/
```

Canonical reproduction:

```sh
node scripts/benchmark/selected-role-scoring-adapter.mjs \
  --run /Users/hendrik/Documents/logo-yoink/runs/2026-08-24-major-brands-300-stage-2 \
  --labels labels/major-brands-300-candidate-labels-v3-2026-08-24.jsonl \
  --output runs/2026-08-24-major-brands-300-optimization/scoring-labels-canonical-reproduced.jsonl
node scripts/benchmark/benchmark.mjs score \
  --run /Users/hendrik/Documents/logo-yoink/runs/2026-08-24-major-brands-300-stage-2 \
  --labels runs/2026-08-24-major-brands-300-optimization/scoring-labels-canonical-reproduced.jsonl \
  --output runs/2026-08-24-major-brands-300-optimization/summary-canonical-reproduced.json
```

Adjudicated diagnostic reproduction:

```sh
node scripts/benchmark/apply-candidate-label-adjudications.mjs \
  --labels labels/major-brands-300-candidate-labels-v3-2026-08-24.jsonl \
  --adjudications reports/major-brands-300-optimization-2026-08-25/selected-slot-adjudications-v1.jsonl \
  --output runs/2026-08-24-major-brands-300-optimization/candidate-labels-selected-slot-adjudicated-v1.jsonl
```

The remaining blocker is a full independent re-review of all 2,732 candidates
with distinct identity, role, safety class, and light/dark judgments. Until that
exists, do not promote a major-brands score or use this cohort to tune recall.
