# Repository commands

Commands are grouped by lifecycle instead of kept in one flat directory:

- `benchmark/` runs repeatable extraction, capture, validation, merge, and replay workflows.
- `review/` builds contact sheets and review packets, imports labels, and measures reviewer agreement.
- `experiments/` contains bounded investigations and historical comparison tools that are not part of the product runtime.
- `maintenance/` validates or regenerates canonical repository data.

Prefer the named npm scripts in `package.json` for supported workflows. Run a file directly only when its documentation calls for that specialist command. Reusable benchmark logic belongs in `benchmark/lib/`; production extraction logic belongs in `src/`.
