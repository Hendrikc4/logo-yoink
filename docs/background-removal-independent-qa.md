# Independent background-removal QA — 2026-09-08

## Protocol

An independent agent reviewed the model comparison and integration behavior. The original tuning/held-out corpus informed safety-guard debugging, so its held-out split is not a pristine final acceptance set. A separate six-logo slice was selected and frozen before any inference on those six images. No settings or guard thresholds were changed in response to that slice.

The six inputs are the first six SVG filenames in lexicographic order from `public/assets/game/logos`: Apple, Figma, GitHub, Google, Instagram, and Notion. Rasterized logo sizes are respectively 96, 160, 80, 240, 32, and 128 pixels square, with transparent padding of one eighth of that size (minimum four pixels). Apple, Google, and Notion use white PNG backgrounds; Figma uses a pale blue-gray PNG background; GitHub uses a pale yellow JPEG background at quality 80; Instagram uses a pale blue-gray JPEG background at quality 80. Original SVG alpha is the reference. This tests fresh shapes, internal negative spaces, small icons, background colors, and JPEG edges.

Frozen source hashes, source images, reference alpha, processing results, are in `runs/background-removal-independent/`. Reproduce preparation with `node scripts/experiments/background-removal-independent.mjs --prepare`, then run inference with `node scripts/experiments/background-removal-independent.mjs` after explicit model setup. The slice uses actual `processAsset` and its worker, with the installed pinned model and production defaults. Model execution is sequential and follows the main experiment, avoiding simultaneous multi-gigabyte model sessions.

## Independent visual review of production examples

The review packet in `docs/background-removal-quality/final-accepted-*-1x.png` and `final-accepted-*-4x.png` places each production result on white, black, and checkerboard backgrounds, top to bottom. The 4× view uses nearest-neighbor enlargement to expose individual edge pixels.

- Final edge-refined thin text and dotted lettering preserve strokes and detached dots, with the pale fringes seen in the raw model output removed. Native-size thin text is clean on black. At 4×, normal pixel-level contour differences remain. Before/after comparison files `edge-refinement-thin-4x.png` and `edge-refinement-disconnected-4x.png` show truth, raw mask output, and refined output from top to bottom.
- The red circular mark retains its intentional white internal T, with no punched-out interior or visible pale exterior halo after refinement.
- The gradient arrow retains its fill and shape. Minor edge softness remains at 4×. The disconnected-dot example retains all four dots, including the smallest green dot; its prior pale residue patch is removed.
- Native stretched IS-Net preprocessing was visibly poor for lettering and extreme aspect ratios. The padded approach is materially better, but raw model predictions still require rejection guards.

## Integration verification

The integration suite covers disabled-mode loading/network isolation; setup checksum failure, partial-file cleanup, corrupt-cache repair, and subsequent offline setup reuse; worker initialization reuse, serialization, queue bounds, crash/timeout recovery; missing/corrupt installations; source preservation; SVG/transparency skips; removal before upscaling; actual CLI enhanced PNG selection; hosted adapter rejection with local modules absent; invalid raster recovery; and rejection of missing detached dots or retained background boxes.

## Frozen fresh-slice results

The actual worker run used the pinned BiRefNet Lite model with `padded-soft-edge-matting` and completed successfully after settings were frozen. No settings changed based on these results.

| Logo | Raster / background | Outcome | Reason | Time |
| --- | --- | --- | --- | ---: |
| Apple | 120×120 PNG / white | Original preserved | foreground-loss | 8.43 s |
| Figma | 200×200 PNG / pale blue-gray | Original preserved | foreground-loss | 7.22 s |
| GitHub | 100×100 JPEG / pale yellow | Original preserved | foreground-loss | 7.04 s |
| Google | 300×300 PNG / white | Original preserved | background-retained | 7.06 s |
| Instagram | 40×40 JPEG / pale blue-gray | Original preserved | foreground-loss | 7.10 s |
| Notion | 160×160 PNG / white | Original preserved | foreground-loss | 7.16 s |

**0/6 fresh images produced an enhancement; 6/6 preserved the exact original asset and data.** This validates conservative refusal on these cases, not successful background-removal generalization. All background remains when an operation is refused. The fresh-slice contact sheet `background-removal-quality/independent-fresh-six.png` shows input and returned image side by side at native size, without enlargement.

The feature has limited coverage by design: it can improve accepted examples while declining common black icon shapes. Do not describe it as universal or artifact-free. The selected accepted-example packet demonstrates the improvement from edge refinement; the fresh slice demonstrates that safety checks can withhold every result in a small unseen batch.
