# All 42 background removal cases: visual QA

Audit date: September 10, 2026. Current model: pinned BiRefNet Lite 512, CPU, overlapping wide-image crops. Background removal remains opt-in and local only.

All 42 inputs were run through the local model. The earlier 7/42 count described accepted transformations, not the number tested. This review includes the raw predictions that safety checks refused, diagnostic edge refinement, original inputs, known-alpha references where available, and actual returned files.

Two independent reviewers split cases 1–21 and 22–42. Each inspected white, black and checkerboard composites at native size and 4×; full raster boards and six overview sheets are in `runs/background-removal-all-42/visual`. Individual findings are recorded in [cases 1–21](background-removal-all-42-first21.json) and [cases 22–42](background-removal-all-42-last21.json).

The review found an actionable ordering bug: early rejection of a raw mask prevented successful edge refinement from being validated. Final production validation now checks the refined result. The final replay accepts **10/42** and preserves **32 originals**. Apple and Figma are two newly accepted brand examples: returned PNGs were verified byte-identical to the diagnostic refined images, then inspected again at 4×; silhouettes, detached leaf, outline strokes and interior openings remain intact without the raw light rims. The wide synthetic wordmark is the third newly accepted case, reviewed by the first reviewer.

Remaining refusals are materially different from these recoverable cases. Examples include missing sponsor logos above DRONE CHALLENGE, partial deletion of the Koteng blue brand panel, loss of white TradeBridge icon details, retained white blobs in Google and Notion, a retained dark blob behind white.io, and JPEG edge contamination. The white iab.spain reference flattened onto white yields blank RGB input; reconstructing it requires another source, not different inference settings. Some tight-cropped logos preserve shapes but still show halos and lack a confident image border for matting.

The 42 examples are a diagnostic/regression corpus and have informed implementation choices. These results are not an unbiased general success estimate, and neither automated acceptance nor this review establishes universally artifact-free output. Raw and diagnostic outputs are review artifacts; refused outputs are not returned as successful transformations.

## Other bugs and experiments

- The component guard exempted one- and two-pixel disconnected components, allowing tiny brand details to vanish undetected. The exemption was removed. Targeted tests failed before the fix and now confirm both erasure rejection and preservation acceptance for components of one, two and three pixels.
- The full real-model run found a cleanup race after all 42 images finished: the awaited `close()` operation had no referenced event-loop handles. The parent exited before cleanup completed and the child could emit an unhandled IPC `EPIPE`. Retirement now retains the process/IPC reference until exit, and child replies handle the parent-disconnect race. Isolated-process regression tests cover both failures.
- A separate confidence-calibration experiment tried making locally uniform, model-supported interiors opaque. It recovered no additional cases and was not shipped. There are no new case-specific exceptions or relaxed quality thresholds.

## Reproduction

After explicit `logo-yoink setup-background-removal`, run `node scripts/experiments/background-removal-all-42.mjs` to save all 42 raw masks, diagnostic refinements and returned images. Use `--replay` for deterministic testing of post-processing changes against those same model predictions. Use `--worker` to rerun all 42 in the real separate-process worker with JavaScript network entry points blocked and assert each mask equals its reviewed prediction. Cached model revision and preset must match before replay/verification.

`node scripts/experiments/background-removal-all-42-visual.mjs` renders all native/4× boards and six overview pages. The gallery builder creates a self-contained HTML comparison with all 42 cases, final reviewer notes, white/black/checkerboard backgrounds and 4× image inspection. The companion workbook includes every case and its raw attempt, reference, returned images and individual findings.

## Final verification

The final real-worker run completed 42/42, with JavaScript network entry points blocked, identical masks to the reviewed predictions, unchanged dimensions, byte-for-byte preservation of every refused original, and clean shutdown (exit 0). [Per-case worker results](background-removal-quality/all-42-worker-results.json) record 10 accepted, 17 foreground-loss, 7 background-retained, 4 edge-uncertain, 2 unsafe-mask and 2 uncertain-background outcomes.

`npm run check` passed all 367 tests, syntax and fixture validation, and local HTTP smoke checks. The gallery loaded all images, filtered correctly to 10 accepted and 32 retained rows, and displayed the 4× inspection dialog. The workbook contains all 42 cases and 209 embedded pictures with valid native relationships; the spreadsheet preview renderer omits images, so embedded-image presence was additionally verified in the exported file and the image panels were inspected separately.
