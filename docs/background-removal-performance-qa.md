# Independent lower-memory background-removal QA — 2026-09-10

## Protocol

The independent reviewer performed no inference and changed no model or safety settings. `scripts/experiments/background-removal-performance-visual.mjs` reads benchmark outputs and generates four-column visual panels (original, known-alpha reference, previous 1024 result, candidate result), each composited on black, checkerboard, and white at native size and nearest-neighbor 4×. It includes the union of previously accepted and candidate-accepted cases, so new refusals are visible rather than excluded.

The diagnostic corpus has 36 images. The six brand examples first frozen for the previous model comparison are reused as a regression slice here; they are no longer unseen data. Neither corpus supports a claim of general successful background removal or universally artifact-free output.

## Plain 512 candidate

The complete benchmark reports 6/42 accepted outputs versus 7/42 previously. `s0-0-thin` and `s1-0-dots` change from processed to original retained. `s7-1-disconnected` changes from retained to processed. All six real brand examples still refuse processing. This is safe preservation but a real coverage regression for lettering.

Visual review found that accepted white-interior symbols retain the intentional white T without holes, gradient arrows retain their fill, and disconnected circles retain all four dots, including the smallest green dot. Their native-size edges look clean against black. At 4×, minor antialiasing and contour differences remain, but no conspicuous pale halo appeared in the reviewed outputs. All original and output dimensions are checked by the benchmark, and all refused outputs are verified byte-identical to their input.

The six accepted outputs have foreground alpha loss below 0.008%, remaining background alpha below 0.006%, and mean absolute edge alpha error below 0.82%. These averages are diagnostic and can hide a localized error; the visual panels are essential evidence alongside them.

Full-run measured average: 1.61 seconds per image; OS peak RSS: 2725 MiB; initialization: 0.78 seconds. These figures describe this machine and batch, not a universal bound.

Panels: `runs/birefnet-512-visual-qa/`. Benchmark source: `~/.cache/logo-yoink/background-removal/experiments/birefnet-512-performance/results.json`.

Plain 512 is not a quality-equivalent drop-in replacement: two previously supported lettering cases now retain their backgrounds. The lower resource use is substantial, but lettering recovery needs review before selecting the final preset.

## Selected 512 preset with two overlapping wide-image crops

The selected preset uses two sequential overlapping crops only when the long/short aspect ratio is at least 2.5. Each crop spans 60% of the long dimension; the mask uses the maximum prediction in their overlap. Other inputs use one padded 512 inference. The original-size safety checks and edge matting remain in force. The model is never asked to process simultaneous crops.

This recovers `s0-0-thin`: all letters and detached i-dots are present, no obvious crop seam appears, and native black/checkerboard/white comparisons are clean. A 4× black crop also shows intact strokes and no pale fringe. The other six accepted files are byte-identical to the plain 512 outputs reviewed above. `s1-0-dots` still refuses; its original white background remains. This is a deliberate coverage tradeoff and must be disclosed, rather than called quality-equivalent.

| Outcome | Previous 1024 | Selected 512 |
| --- | ---: | ---: |
| Diagnostic cases processed | 7/36 | 7/36 |
| Reused fresh-brand cases processed | 0/6 | 0/6 |
| Total originals retained | 35/42 | 35/42 |

The same total hides one loss (`s1-0-dots`) and one gain (`s7-1-disconnected`). All accepted images remain synthetic examples. Selected-run average time is 2.25 seconds per image, OS peak RSS 2788 MiB, and initialization 0.72 seconds. Accepted foreground alpha loss stays below 0.014%, remaining background alpha below 0.006%, and mean edge alpha error below 0.82%.

**QA decision:** The selected preset is suitable as the lower-resource optional default, with the dotted-wordmark refusal explicitly documented. None of the reviewed accepted outputs visibly erase lettering, punch out intended white details, or introduce conspicuous halos. It is not a promise of universal quality or broad real-brand coverage. A future independent unseen corpus is still required to establish generalization.

Reproduce panels after the explicit benchmark: `QA_VARIANT=birefnet-512-tiled node scripts/experiments/background-removal-performance-visual.mjs`. Selected panels: `runs/birefnet-512-tiled-visual-qa/`; raw results: `~/.cache/logo-yoink/background-removal/experiments/birefnet-512-tiled-performance/results.json`. These are a model-output comparison, not a replacement for production-worker integration tests.
