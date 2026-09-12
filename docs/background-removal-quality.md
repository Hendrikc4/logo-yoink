# Local background-removal quality experiment

Historical 1024-preset report. The current shipping 512 preset and updated resource/quality measurements are documented in [the performance follow-up](background-removal-performance.md).

Run date: 2026-09-08. Node 24.2.0, Sharp 0.35.3, ONNX Runtime Node 1.22.0, Apple M1 Pro / 32 GiB, macOS 26.6.2. All model predictions used the CPU provider. No image was sent to an inference service.

## Selected model and settings

BiRefNet Lite FP32, aspect-preserving padding, soft alpha with conservative local edge matting (`padded-soft-edge-matting`). Its padded predictions preserve detached dots and thin wordmarks that ISNet often erases. It costs substantially more CPU and memory, and does worse on tiny icons. The safety checks intentionally preserve originals when uncertain; this is an optional enhancement, not a universally reliable logo extractor.

| Artifact | Pinned revision | SHA-256 |
| --- | --- | --- |
| [BiRefNet Lite ONNX FP32](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/de15b22ba131738a16dff04aab8bdf8dc32e3ac1/onnx/model.onnx) | `de15b22ba131738a16dff04aab8bdf8dc32e3ac1` | `5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333` |
| [ISNet ONNX FP32, comparison only](https://huggingface.co/onnx-community/ISNet-ONNX/resolve/3fe6e3db3e32c69aadde61fe388ddb1a0574440c/onnx/model.onnx) | `3fe6e3db3e32c69aadde61fe388ddb1a0574440c` | `8bc7e049e30cdda79a47e111673d3620096993b7c751ca2cb474591c23bfe4b5` |

The selected [BiRefNet artifact declares MIT](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX). The tested [ISNet conversion declares AGPL-3.0](https://huggingface.co/onnx-community/ISNet-ONNX), despite the upstream DIS code having an Apache license. The ISNet comparison artifact is not installed by setup.

The selected preprocessing converts to sRGB, resizes the longer side to 1024 with linear interpolation, preserves the aspect ratio using rounded dimensions, and centers on a white 1024×1024 canvas. Input NCHW RGB normalization uses means `[0.485, 0.456, 0.406]` and standard deviations `[0.229, 0.224, 0.225]`. Apply sigmoid to output logits, quantize to an 8-bit mask, crop away padding, and resize linearly to original dimensions. Apply the soft mask as alpha, then refine only the model-guided boundary using the validated background color and nearby solid foreground colors, as described below. No erosion, blanket color deletion, min/max normalization of BiRefNet probabilities, or naive inverse compositing based on model alpha is used.

## Corpus and experimental design

The checked-in `test/fixtures/background-removal/manifest.json` contains 36 cases: 24 synthetic images with known alpha (eight logo structures, each on white, pale blue, and JPEG-compressed pale yellow), eight existing cached real assets, and four stress cases (white on dark, near-background contrast, soft shadow, full-bleed badge). Synthetic structures cover thin lettering, detached dots, white interior symbols, gradients, tiny icons, wide wordmarks, outlines, and disconnected marks. Cached source paths are preserved in the manifest; normalized image bytes are checked in, so rerunning inference does not require the original cache or fonts.

Sixteen cases are marked tuning and twenty heldout. The split is by synthetic structure rather than different backgrounds of the same structure. This is a small engineering diagnostic, not an unbiased benchmark: both splits were visually inspected during debugging and informed safety requirements. The split labels remain fixed, but claims of untouched heldout generalization would be inappropriate. Seven real assets have alpha references; one opaque real asset has no ground truth. A white-on-white flattened real reference is intrinsically ambiguous and should be skipped.

Both models ran all 36 cases in native distorted-square and padded modes (144 actual CPU predictions). Soft and conservative refinement (`clamp((alpha − 0.02)/0.96)`) reused each prediction. Refinement did not reliably improve edge error or preservation, so soft alpha was retained. Native distorted-square input caused severe geometric mask artifacts in wide text; padded input was substantially better.

Raw metrics, before safety checks, are in [summary.json](background-removal-quality/summary.json), with complete per-case measurements alongside it. Foreground loss is mean `1−alpha` on truth alpha ≥250; remaining background is mean predicted alpha on truth alpha 0; edge error is mean absolute alpha error on partially transparent truth pixels. Values are fractions, averaged per eligible image; lower is better. RSS is whole-process resident memory, not a clean isolated model allocation. Four threads were used for model comparison; shipping inference uses two threads.

Visual review covered white, dark, and checkerboard composites at native size and nearest-neighbor 4×. Independent review confirmed erased dots, pale rectangular residue, retained background stripes, and faded real wordmarks among raw rejected predictions. Safety uses background/color evidence only to reject a complete prediction, never to delete by color: validate near-uniform borders; reject lost contrasting foreground interiors or disconnected components; and reject retained border-connected background away from the antialias contour. Global nearly empty/full-mask checks provide another rejection layer.

Inverse compositing of partial-alpha colors against the border estimate was also measured against known truth. It reduced some average errors but worsened tiny icons and created uneven bright contour pixels where model alpha was already opaque. It was rejected. Pale edge contamination can still remain in flattened low-resolution inputs; users retain the canonical original and should visually review processed exports.

## Reproduction

Normal tests and installation do not download models. To reproduce the heavier experiment, explicitly install the pinned runtime into `~/.cache/logo-yoink/background-removal/runtime`, download the two linked artifacts above into `~/.cache/logo-yoink/background-removal/experiments/{birefnet,isnet}.onnx`, and verify their SHA-256 values. The scripts make no inference network calls and use only those explicit local files.

```sh
npm install --prefix "$HOME/.cache/logo-yoink/background-removal/runtime" --no-audit --no-fund --omit=dev onnxruntime-node@1.22.0
node scripts/experiments/background-removal-quality.mjs
node scripts/experiments/background-removal-report.mjs
node scripts/experiments/background-removal-acceptance.mjs
node scripts/experiments/background-removal-defringe.mjs
node scripts/experiments/background-removal-production.mjs
node scripts/experiments/background-removal-matting.mjs
node scripts/experiments/background-removal-replay.mjs
```

The quality script reads frozen fixtures by default. `--generate-only` rebuilds them and therefore requires the original cached real source assets and local Arial font; this is deliberately separate from normal reproducible inference. `QA_MODEL=isnet` or `QA_MODEL=birefnet` selects one comparison model; `QA_ONLY` is a comma-separated case filter. Outputs go to the experiments cache. The production script invokes the exact shipping predictor and `removeLocalBackground` transformation, including safety gates, for all fixtures.

Two harness issues were detected and corrected before final results: Sharp's single-channel raw input becomes RGB after resize unless explicitly converted back to grayscale, and default cover resizing differs from explicit fill at rounded fitted dimensions. All final comparisons were rerun after the grayscale correction, and shipping preprocessing was aligned to explicit fill before final production verification. Discarded exploratory results are not included.

## Measured raw comparison

| Model / input | Split | Foreground loss | Background left | Edge alpha error | Mean inference |
| --- | --- | ---: | ---: | ---: | ---: |
| isnet / native | tuning | 28.87% | 10.58% | 30.36% | 1.07 s |
| isnet / native | heldout | 28.10% | 12.41% | 38.38% | 1.11 s |
| isnet / pad | tuning | 7.31% | 2.32% | 19.87% | 1.12 s |
| isnet / pad | heldout | 15.37% | 19.43% | 25.21% | 1.14 s |
| birefnet / native | tuning | 36.37% | 9.87% | 29.97% | 5.16 s |
| birefnet / native | heldout | 22.26% | 13.38% | 41.87% | 5.54 s |
| birefnet / pad | tuning | 14.49% | 1.76% | 19.90% | 4.63 s |
| birefnet / pad | heldout | 8.27% | 10.72% | 25.78% | 5.21 s |

These include bad predictions that are subsequently rejected; they are not the quality of delivered outputs. The white-on-white ambiguous case contributes a large error to raw averages. The selected model is not uniformly better on every category: it improves detached details and text coverage, while ISNet performs better on tiny icons.

Stored-mask safety evaluation (tuning): 6/16 applied. Status counts: applied 6, background-retained 2, foreground-loss 7, uncertain-background 1.

Stored-mask safety evaluation (heldout): 8/20 applied. Status counts: applied 8, background-retained 7, foreground-loss 3, uncertain-background 1, unsafe-mask 1.

## Model-guided edge matting

The initial accepted soft-mask outputs still had visible pale fringes. A bounded second experiment projects boundary pixels onto the line between a validated uniform background and a nearby solid foreground core. Unlike naive inverse compositing, this estimates the edge alpha from local foreground color rather than assuming the model alpha is exact. Refinement touches only a two-pixel band next to confidently identified background; it searches at most four pixels for a solid core, requires a projection residual ≤8 RGB units, and keeps internal opaque white symbols. Confidently transparent model pixels seed enclosed holes so letter counters receive the same correction.

Predictions are rejected as `edge-uncertain` if more than the greater of eight pixels or 1% of candidate boundary pixels cannot be resolved. This deliberately rejects JPEG-contaminated edges and thin outlines without a reliable solid core. It preserves the original rather than claiming those contours are clean. All earlier raw-mask metrics and visual artifacts remain labeled as pre-refinement evidence.

Against known truth on black, thin lettering composite error dropped from 1.28% to 0.0064%, white interior symbol from 0.439% to 0.0058%, gradient from 0.556% to 0.0156%, and detached shapes from 0.498% to 0.0042%. See [matting metrics](background-removal-quality/matting-metrics.json), [thin before/after at 4×](background-removal-quality/matting-before-after-thin-4x.png), and [white symbol before/after at 4×](background-removal-quality/matting-before-after-white-detail-4x.png). Each comparison image has truth, raw soft mask, and refined output from top to bottom. White symbols and detached components remain intact.

## CPU memory checks

The first production sweep was stopped after detecting approximately 11,500 MiB resident memory with default ONNX arena settings. Disabling both CPU memory arena and memory patterns, explicitly disposing input/output tensors, and releasing the session on experiment completion produced byte-identical masks on a three-case comparison. Peak resident memory was still approximately 8,440 MiB (8.24 GiB; OS-observed peak approximately 9.1 GB). The model has a fixed 1024×1024 input; a simple 512 input override is unsupported. No graph rewrite or untested lower-resolution model is shipped.

Use a machine with at least 16 GB RAM for this optional CPU feature, and expect several seconds per logo. Requests are serialized to prevent multiplying that footprint. This is a substantial memory requirement; ISNet was smaller (~1,130 MiB in the comparison) but preserved fewer tested text/dot cases. The final production sweep uses the bounded session settings and two CPU threads.

For the 13 accepted predictions with known alpha (one accepted real image lacks truth), the stored-mask evaluation averages 0.57% foreground loss, 0.26% remaining background alpha, and 19.44% alpha error on partially transparent edge pixels. Low interior loss does not imply perfect antialias reconstruction: edge accuracy remains the main limitation.

Pre-refinement independent visual QA artifacts (each shows white, black, and checkerboard composites): [thin lettering 1×](background-removal-quality/accepted-s0-0-thin-1x.png), [thin lettering 4×](background-removal-quality/accepted-s0-0-thin-4x.png), [detached dots 4×](background-removal-quality/accepted-s1-0-dots-4x.png), [white interior detail 4×](background-removal-quality/accepted-s2-0-white-detail-4x.png), and [gradient 4×](background-removal-quality/accepted-s3-0-gradient-4x.png). Review found complete letters/dots and intact interior symbols, with mild pale edge fringe visible on black (most apparent at 4×, and faintly visible at native size on thin strokes). These are evidence for conservative preservation, not a claim of artifact-free reconstruction.

## Final production verification

The exact two-thread predictor completed all 36 inputs with the memory options above and clean session shutdown. Final edge matting was then replayed through the shipping `removeLocalBackground` transformation using cached predictions from the same model and preprocessing; the execution-option comparison had verified identical masks on three cases. No new inference or model retuning was needed. [Final per-case statuses](background-removal-quality/production-refined.json) record **7 processed PNGs and 29 byte-for-byte preserved originals** (3/16 tuning and 4/20 diagnostic heldout). None of the four added stress cases was accepted. This intentionally low coverage favors logo integrity over applying an unsafe effect.

Final status counts: applied: 7; background-retained: 9; foreground-loss: 10; edge-uncertain: 7; uncertain-background: 2; unsafe-mask: 1.

For the seven accepted known-alpha examples, mean black-composite RGB error changed from 0.728% to 0.010%.

The real two-thread sweep averaged 7.07 seconds per image including transformation, with peak measured RSS 8548 MiB. See [production timing records](background-removal-quality/production.json).

A separate agent prepared a fresh six-logo slice after settings were frozen for independent checks of the final worker-backed transformation; see the results and final visual review recorded separately in [independent QA](background-removal-independent-qa.md). This is the independent validation slice; the earlier 36-case split was used diagnostically during development.
