# Documentation guide

Start with the root [README](../README.md) for installation, CLI/API usage, and a product overview. Read [architecture.md](architecture.md) for code ownership and [repository-audit.md](repository-audit.md) for the cleanup rationale.

## Current reference material

- [Current optimization plan](current-system-logo-optimization-plan.md) — goals, metrics, and constraints for the current extraction system.
- [Current optimization results](current-system-logo-optimization-results.md) — current frozen-baseline results.
- [500-company visual benchmark plan](500-company-visual-logo-benchmark-plan.md) — benchmark design and evaluation protocol.
- [Benchmark execution guide](benchmark-execution-2026-08-22.md) — capture and review execution details.
- [Combined 800-company benchmark](combined-800-benchmark-2026-08-25.md) — current cross-cohort result, qualification limits, and overfit audit.
- [BIMI icon fallback experiment](bimi-fallback-experiment-2026-08-25.md) — opt-in DNS fallback, frozen prevalence/ordering evidence, and independent review iteration.
- [Expansion reachability recovery](expansion-reachability-recovery-2026-08-25.md) — failure taxonomy, bounded homepage recovery, and development/validation results.
- [Candidate-only labeling](candidate-only-labeling.md) — current candidate-sheet labeling workflow.
- [Experiment log](experiment-log.md) — chronological index of ranking and discovery experiments.
- [Visual benchmark schema](../schemas/visual-benchmark-v1/README.md) — persisted benchmark records and validation.

## Planning records

These documents explain how the current approach was reached. Treat them as design history rather than current operating instructions.

- [Logo discovery plan](logo-discovery-plan.md)
- [Logo coverage improvement plan](logo-coverage-improvement-plan.md)
- [Wide logo improvement plan](wide-logo-improvement-plan.md)
- [Wide logo improvement plan v2](wide-logo-improvement-plan-v2.md)
- [Next optimization experiments](logo-optimization-next-experiments.md)
- [Cowboy runner implementation plan](cowboy-runner-implementation-plan.md)

## Historical experiment and audit results

Files with dated results capture a specific frozen run. They are evidence, not a description of current behavior.

- [Benchmark baseline, 2026-08-22](benchmark-2026-08-22.md)
- [Coverage experiment, 2026-08-22](logo-coverage-experiment-results-2026-08-22.md)
- [Coverage experiment round 2, 2026-08-22](logo-coverage-experiment-results-round2-2026-08-22.md)
- [Missing-wide root-cause audit, 2026-08-22](missing-wide-root-cause-audit-2026-08-22.md)
- [First-party wide discovery, 2026-08-23](first-party-wide-discovery-2026-08-23.md)
- [Numbered AI labeling audit, 2026-08-23](numbered-ai-labeling-audit-2026-08-23.md)
- [Rendered-wide experiment 3, 2026-08-23](rendered-wide-experiment-3-results-2026-08-23.md)
- [Harker wide-logo discovery, 2026-08-24](harker-wide-logo-discovery-results-2026-08-24.md)
- [Selection v2 experiment, 2026-08-24](selection-v2-experiment-2026-08-24.md)
- [Wide CSS recovery, 2026-08-24](wide-logo-css-recovery-results-2026-08-24.md)
- [Wide header retention, 2026-08-24](wide-logo-header-retention-results-2026-08-24.md)
- [Wide rescue experiment 1, 2026-08-24](wide-rescue-experiment-1-results-2026-08-24.md)

## Design material

- `docs/design/` contains design explorations and implementation references.
- `design/mockups/` is a second historical mockup root and should eventually be consolidated into `docs/design/`.
- `public/assets/` contains files shipped by the site; it is not a design archive.
