# Benchmark ownership guide

This directory owns Logo Yoink's reusable offline benchmark modules and documents its canonical data. Executable entrypoints remain under categorized `scripts/` folders so commands are easy to discover without mixing them into library code.

## What belongs to the benchmark

- frozen company cohorts and shard assignments;
- capture and review schemas;
- deterministic capture, merge, validation, labeling, and scoring libraries;
- thin command-line entrypoints for those operations;
- adjudicated labels and selected reports needed to explain published metrics.

Runtime extraction, the public demo, and frontend code do not belong here.

## Current locations

| Material | Current location | Ownership |
| --- | --- | --- |
| Benchmark commands | `scripts/benchmark/` | Capture, validation, merge, replay, and scoring entrypoints |
| Review commands | `scripts/review/` | Contact sheets, packets, labels, agreement, and review merging |
| Experiment commands | `scripts/experiments/` | Historical and exploratory comparison workflows |
| Maintenance commands | `scripts/maintenance/` | Fixture export and validation |
| Reusable benchmark libraries | `benchmark/lib/` | Capture, eligibility, and canonical label logic |
| Frozen benchmark assignments | `benchmarks/` | Canonical tracked input |
| Source company fixtures | `fixtures/` | Canonical tracked input |
| Record schemas | `schemas/visual-benchmark-v1/` | Canonical tracked contract |
| Adjudicated and challenge labels | `labels/` | Canonical tracked evaluation data |
| Selected experiment output | `reports/`, `reviews/` | Tracked only when needed to support a documented result |
| Generated captures and runs | `runs/` | Generated and gitignored |

## Supported commands

Use package scripts where one exists:

```bash
npm run benchmark -- --cohort original-100 --output runs/my-run
npm run visual-benchmark:shards -- --help
npm run visual-benchmark:capture -- --help
npm run visual-benchmark:validate -- --help
npm run visual-benchmark:merge -- --help
npm run visual-benchmark:review -- --help
npm run visual-benchmark:label-sheets -- --help
npm run visual-benchmark:agreement -- --help
npm run visual-benchmark:replay -- --help
```

Additional commands without package aliases are internal, historical, or migration tools. Their directory indicates their lifecycle; do not assume that an unlisted command is safe to delete without checking documentation, tests, and prior run manifests.

## Data rules

- Commit frozen inputs, schemas, adjudicated labels, and compact evidence for published claims.
- Keep raw/generated run directories under `runs/`.
- Do not commit candidate data URLs; benchmark assets should be content-addressed files.
- Treat evaluation splits as holdouts and avoid using their labels to tune ranking rules.
- Validate fixtures and benchmark records before comparing results: `npm test` includes fixture validation.

## Local run retention

`runs/` can grow very large and is intentionally gitignored. Keep frozen inputs needed by an active comparison and the final compact reports; archive or remove superseded raw captures manually after verifying no document or replay depends on them. Inspect usage with `du -sh runs/* | sort -h`. Cleanup is deliberately not automated because historical reports may reference local run artifacts.

## Layout

```text
benchmark/
  README.md
  lib/              # reusable capture, eligibility, and label logic
scripts/
  benchmark/        # repeatable benchmark entrypoints
  review/           # labeling and review entrypoints
  experiments/      # exploratory and historical workflows
  maintenance/      # repository data maintenance
```

Frozen data remains in the existing `benchmarks/`, `fixtures/`, `labels/`, and `schemas/` roots for now. Moving large canonical datasets is a separate migration and should not be mixed with behavior changes.
