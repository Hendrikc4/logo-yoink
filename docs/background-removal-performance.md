# Local background-removal resource experiment

Current coverage and retry behavior are recorded in the [pipeline update](background-removal-pipeline-v2.md). This page preserves the earlier matched resource benchmark.

Follow-up: the [all-42 visual audit](background-removal-all-42-qa.md) found and fixed premature validation before matting, increasing current acceptance to 10/42 (including Apple and Figma). The resource-comparison counts below describe the earlier 7/42 preset evaluation, before that fix.

September 10, 2026. Apple M1 Pro, 32 GiB RAM, Node 24.2.0, ONNX Runtime Node 1.22.0, CPU with two inference threads. Model runs are sequential, never concurrent. The earlier [quality experiment](background-removal-quality.md) remains a historical record of the 1024 preset.

## Research and decision criteria

- [BiRefNet Lite 512 export](https://huggingface.co/studioludens/birefnet-lite-512): a separately exported fixed-resolution graph, with ImageNet normalization and logits requiring sigmoid. Halving each input dimension reduces spatial activation sizes; actual memory and quality must still be measured. This is not an unsupported input-size override on the old graph. The publisher declares MIT and identifies ZhengPeng7/BiRefNet_lite as the base model.
- [ONNX Runtime FP16 guidance](https://onnxruntime.ai/docs/performance/model-optimizations/float16.html): CPU float16 operator support is limited. Smaller FP16 weights are not evidence of smaller CPU activation memory; retain FP32 for the portable CPU preset.
- [ONNX Runtime quantization guidance](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html): quantization can lose accuracy and introduce conversion overhead. No uncalibrated INT8 graph is substituted for a tested logo preset.
- [ONNX Runtime allocator guidance](https://onnxruntime.ai/docs/get-started/with-c.html): arenas can retain allocations. The previous implementation already disabled CPU arena and memory patterns. The new lifecycle work releases idle workers and avoids overlapping old/new native sessions.
- [Rembg model catalogue](https://github.com/danielgatis/rembg#models): U2NetP is a much smaller alternative, but requires separate model/quality qualification. Prior ISNet tests already demonstrated loss of lettering/dots. This experiment first evaluates a lower-resolution export of the selected architecture rather than accepting those known regressions.

Candidate artifact: `studioludens/birefnet-lite-512`, revision `4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7`, `onnx/model.onnx`, 191,877,254 bytes, SHA-256 `1cb0fb360dadd15af77c639085d77a9df67db0c64315560c3de005f676345ac2`. Download and verify explicitly; no runtime inference or normal tests download models.

## Selected preset and results

Ship the pinned 512 FP32 graph with existing ImageNet normalization, padded linear resizing, sigmoid, original-size safety checks and edge matting. Inputs with aspect ratio at least 2.5 use two sequential overlapping crops, each covering 60% of the long dimension. The overlap takes maximum alpha, favoring preservation; the entire assembled mask must still pass unchanged safety checks. Compact inputs require only one model operation. No automatic fallback loads the large 1024 model. No user-facing tuning controls were added.

| Measurement | Previous 1024 | Selected 512 |
| --- | ---: | ---: |
| OS peak RSS, model benchmark | 8778 MiB (8.57 GiB) | 2788 MiB (2.72 GiB) |
| Mean latency, same seven inputs, excluding initialization | 7.85 s | 2.07 s |
| Initialization | 1.34 s | 0.72 s |
| Mean latency, all 42 selected-preset inputs | — | 2.25 s |
| Diagnostic cases accepted | 7/36 | 7/36 |
| Reused brand cases accepted | 0/6 | 0/6 |

This is **68.2% less peak memory** and **3.8× faster matched mean processing**, measured on this machine. The shorter 1024 sweep and full 512 sweep have different lengths, so compare latency only on the shared seven-image subset; peak figures cover each whole process. File size shrank only from about 214 to 183 MiB: most of the runtime saving comes from smaller intermediate tensors, not fewer weight bytes.

All seven accepted files remain synthetic examples. One earlier success, the dotted `jiji.io` wordmark, now returns the unchanged original; a pale-gray-background detached-dot case is newly accepted. The overall count therefore conceals a real coverage tradeoff. Safety thresholds were not relaxed. Mean accepted foreground alpha loss is 0.0056%, remaining background alpha 0.0010%, edge alpha error 0.517%, and black-composite RGB error 0.0075%. These small diagnostic averages do not establish generalization or guarantee artifact-free results.

[Independent visual QA](background-removal-performance-qa.md) inspected the union of old/new accepted cases on black, white and checkerboard backgrounds at native size and 4×. The recovered thin wordmark showed intact letters and dots with no visible crop seam. The accepted white symbols, gradients and detached details remained intact.

Plain padded 512 was faster (1.61 s over 42 inputs), but refused both thin and dotted lettering. Two overlapping crops recovered thin lettering. Three half-width crops and trimming exactly uniform outer margins were also tried on diagnostic cases; neither recovered the dotted wordmark, so their extra work/complexity is not shipped. These experiments informed the preset; neither evaluation slice is now unseen.

Raw records: [1024 baseline](background-removal-quality/performance-1024.json), [plain 512](background-removal-quality/performance-512-plain.json), [selected 512](background-removal-quality/performance-512.json). Ordinary installation still downloads neither runtime nor weights; existing installations must explicitly rerun `logo-yoink setup-background-removal` for the new revision.

## Runtime lifecycle and offline verification

The first idle-release attempt closed the ONNX session and terminated its Node worker thread. The native allocator still left 2144 MiB in the parent process, versus an 86 MiB baseline. This was not sufficient resource recovery. The final worker uses a forked local Node process with binary IPC. Idle shutdown after five seconds exits that process, reclaiming its entire address space. It also exits when the parent disconnects. Initialization is reused within a batch, and replacement waits for the old process to exit. Selecting the exact same asset object for icon and logo now processes it only once.

The exact production process worker ran the shared seven cases with `fetch`, HTTP/HTTPS and socket-connect entry points disabled in both parent and child. All output bytes matched the reviewed candidate outputs, one worker served the batch, and it exited after idle. Sampled combined parent+child peak was 2704 MiB; the remaining parent was 95.7 MiB after shutdown, versus 86.0 MiB before inference. The first thin-wordmark call including startup took 4.43 s; later compact calls took about 1.55–1.57 s. Idle restart pays initialization again. The whole application can of course use additional memory beyond this focused harness.

Reproduce with `node scripts/experiments/background-removal-worker-performance.mjs` after setup and the selected-preset benchmark. This resource sampler uses the macOS/Linux `ps` utility; production inference does not depend on it. Raw [thread attempt](background-removal-quality/performance-thread-idle.json) and [final process measurements](background-removal-quality/performance-process-idle.json) distinguish parent-only memory from combined process memory, so the memory reduction is not an accounting trick.

## Reproduction

Run `QA_TILED=1 node scripts/experiments/background-removal-performance.mjs` after placing the verified candidate at `~/.cache/logo-yoink/background-removal/experiments/birefnet-512.onnx` and installing the local runtime through setup. Omit `QA_TILED` to reproduce the plain 512 comparison. It evaluates the frozen 36 diagnostic cases plus six fixtures in `test/fixtures/background-removal-independent`, using unchanged safety checks and edge matting. The six previously independent examples are now regression cases, not new unseen evidence. Outputs and per-image status, time, foreground loss, background alpha, edge alpha error, and black-composite error are saved in the experiment cache. Rejected results must preserve input bytes and all results must preserve dimensions.

The contemporaneous 1024 comparison uses `QA_VARIANT=birefnet QA_SIZE=1024 QA_ONLY=s0-0-thin,s1-0-dots,s2-0-white-detail,s3-0-gradient,s7-0-disconnected,fresh-apple,fresh-google node scripts/experiments/background-removal-performance.mjs`. Compare that same seven-image subset for latency, not a different mix of accepted/rejected inputs. Initialization is recorded separately. Peak memory includes model loading and the full process, measured by both RSS sampling and OS high-water mark; it is not a universal hardware requirement.

## Verification

`npm run check` passed: 357 tests, syntax/fixture checks and local HTTP smoke test. New tests cover sequential overlapping-crop geometry in both orientations, malformed crop masks, single-view compact inputs, batch reuse, bounded idle disposal, teardown/replacement races, shared icon/logo deduplication, binary child IPC, actual child exit/restart and parent disconnect. Existing disabled/offline/setup/corruption/hosted-block/original-preservation/upscale coverage remains passing. The separate real-model offline worker benchmark additionally checks byte-identical outputs against the candidate sweep.
