# Identity-verifier and benchmark cycle summary

Date: 2026-08-25

## Executive decision

The asynchronous identity-verifier infrastructure is implemented and retained, but
no tested model/prompt bundle passed the required calibration gate. It is therefore
not connected to deferred enrichment or any synchronous production path. The public
extractor remains deterministic and AI-free. Workstreams 2–4 were intentionally not
run because the governing directive required a hard stop after a leaky Workstream 1.

The separate major-brands benchmark expansion did complete. Its fixture, exhaustive
candidate labels, selected-slot scoring adapter, reports, and raw local run are
preserved. This adds benchmark coverage and exposes current weaknesses; it does not
claim a benchmark improvement or change production ranking.

## What worked

- The verifier module provides deterministic light/dark rendering, strict structured
  `accept | reject | ambiguous` responses, one retry, veto-only semantics, a
  content-addressed prompt-versioned cache, and zero-network replay.
- Page identity was frozen for 58/58 development domains: 95 requests, 22,392,513
  bytes, and 416/1,520 ms request p50/p95.
- Luna v2 and v4 produced zero wrong accepts on the 38-case development set, proving
  that conservative prompting can enforce safety on that packet.
- The 300-company expansion preserves the original 500 rows in a separate
  `fixtures/companies-800.json` file and adds a deterministic `major-brands-300`
  cohort.
- The v3 benchmark review covered all 2,732 discovered candidates and the scoring
  adapter converted exhaustive candidate labels into all 368 required selected-slot
  judgments without mutating identity ground truth.
- The complete expansion score is 50.62/100. Whole-cohort candidate-set coverage is
  208/300 (69.33%) for icon and 78/300 (26.00%) for wide.

## What did not work

| Model/prompt | Accept precision | Harmful behavior | Legitimate-case behavior | Decision |
| --- | ---: | --- | --- | --- |
| Luna v1 | 6/7 (85.714%) combined | Accepted Userpilot | Partial | Stop |
| Luna v2 | 9/9 (100%) | Zero wrong accepts | Systematically rejected Willow→Because and Digitoys | Stop: recall/policy-limited |
| Luna v3 | 9/10 (90.000%) | Accepted Bhr→RealReports | Digitoys passed; Willow rejected | Stop: precision-limited |
| Luna v4 | 3/3 (100%) | Zero wrong accepts | Systematically rejected Because and Digitoys | Final Luna stop |
| Sol with v3 prompt | 11/13 (84.615%) | Accepted Userpilot and Genopets | Because and Digitoys passed | Final stop: precision-limited |

The prepared 120-case fresh holdout was never reviewed, so it remains pristine. No
configuration reached the development gate and none may be described as production
qualified. Subscription task tokens and marginal dollars were unavailable; recorded
orchestration time was 238.4 seconds for Luna v1, 668.5 seconds total for Luna v2–v4,
and 844.3 seconds for Sol (22.22 task-seconds per judgment for Sol). These are task
durations, not provider latency.

The first major-brand labeling pass was also not adequate for scoring: it left 1,932
of 2,731 reviewed tiles ambiguous. It is retained only as a negative
label-completeness result. The exhaustive v3 pass supersedes it.

## Production and benchmark disposition

- Keep the verifier scaffold, prompt versions, cache contract, CLI, renderer, and
  tests as offline/deferred research infrastructure.
- Do not enable verifier verdicts, browser-warming-with-veto, rendered-wide capture,
  foreign-name relief, or AI identity statuses in production.
- Keep the selected-role scoring adapter and explicit `correct` support in the
  benchmark scorer. These affect offline evaluation only.
- Keep the separate 800-company fixture and tracked v3 candidate labels. The frozen
  500-company fixture, labels, packet membership, and evaluation split remain
  unchanged.
- The expansion's 103/227 reachable wrong-brand domains and 28.63% wide top-1
  correctness are diagnostic baselines for future deterministic precision work, not
  a shipped score gain.

## Integration verification

- The tracked v3 labels reproduced the canonical 50.62/100 score from the retained
  raw run and emitted 3,100 scoring records.
- `npm run check` passed: 216/216 tests, fixture validation, syntax validation,
  benchmark-qualification check, browser-backed tests, and local homepage/API smoke.
- The formerly failing pilot-fixture contract test was fixed by defining `all-500` as
  every non-`major-brands-300` row present in the supplied fixture. This preserves the
  500/800 separation while allowing intentionally small contract fixtures.

Detailed evidence: [Luna v1](luna-identity-verifier-gate-2026-08-24.md),
[Luna v2–v4](luna-identity-verifier-context-retest-2026-08-25.md),
[Sol escalation](sol-identity-verifier-escalation-2026-08-25.md),
[major-brands stage 2](major-brands-300-stage-2-run-2026-08-24.md), and
[major-brands stage 3](major-brands-300-stage-3-score-2026-08-24.md).
