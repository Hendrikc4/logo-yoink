# Background-removal pipeline update

September 11, 2026. Local CPU processing remains opt-in and disabled by default.

## Executive summary

Transparent output coverage increased from 10/42 to 21/42 on the original regression corpus. Independent visual review found 16 clean results, four usable with minor artifacts, and one semantic ambiguity: a blue BADGE panel becomes a white wordmark. That last case is a successful cutout but **does not preserve the reference's intended opaque panel**. Do not count it as a reference-quality pass.

An additional 18 inputs produced 14 transparent outputs: five clean and nine with minor halos or JPEG specks. Four originals were retained. No other major visible structural failures were observed in the final returned outputs. Review used white, black and checkerboard backgrounds at native size and 4×, with output hashes and image evidence. This is limited-corpus evidence, not universally artifact-free removal.

## Pipeline and resource tradeoffs

1. Keep selected SVGs and existing alpha unchanged. For an opaque raster, first look for an already-discovered transparent source with verified same-family membership, role, known theme/color and matching proportions. Decode and validate its pixels before using it. This path performs no model inference and requires no new downloads. Canonical assets stay separate from the derived PNG.
2. Share removal promises for identical image bytes within an extraction. This avoids duplicate inference for icon/logo selections while preserving each asset's metadata.
3. Lazily run the pinned BiRefNet Lite 512 FP32 model in a reusable child process, sequentially with two CPU threads. Wide/tall inputs use two overlapping views. Model revision: `4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7`; SHA-256: `1cb0fb360dadd15af77c639085d77a9df67db0c64315560c3de005f676345ac2`; ONNX Runtime Node 1.22.0. Current preset: `logo-flat-soft-matting-v2`.
4. On demonstrably flat canvases, combine model evidence with connected background regions to recover thin lettering and detached dots. This is not global color deletion. Refine edge alpha and RGB locally; leave unresolved pixels unchanged. General edge uncertainty tolerance is 20%, while strongly evidenced background uses a separate 5% budget to avoid obvious rings. Small JPEG specks are allowed; significant component loss and ambiguous filled/erased interiors remain guarded.
5. If quality checks reject the first result, try one alternate padded view (12% of the short dimension, bounded to 8–128 pixels). Crop back to the original canvas and rerun the same checks. No larger model is loaded. Setup/runtime/queue failures do not trigger this retry.
6. Preserve originals on failure; return successful PNGs separately, then optionally upscale. Return method, attempts and reasons in transformation metadata. Evict the model process after five idle seconds.

The real 60-input run took 222.7 seconds: 3.71 seconds/input including startup, processing and retries. The 32 one-attempt inputs averaged 2.19 seconds; 28 two-attempt inputs averaged 5.46 seconds. Five additional outputs were recovered by retry. These groups contain different images, so this is a workload breakdown, not a matched speed comparison. Source reuse and request deduplication avoid inference entirely when applicable; this isolated-image corpus does not measure their end-to-end website frequency.

The earlier matched 512-versus-1024 benchmark measured 68% lower peak memory and 3.8× faster inference, with approximately 2.7 GiB peak RSS. Those are **historical model benchmarks**, not a new memory measurement of this complete update. The model, two-thread limit, sequential execution and process release remain the same. Retry adds CPU time; it does not load a second concurrent model. See [resource measurements](background-removal-performance.md).

## Remaining limitations

- Some tiny marks, low-contrast logos, soft shadows and compressed edges still return the original. Original42 coverage is 50%; it is not yet reliable for every logo.
- White brand details and transparent letter counters can have identical flattened pixels. Color and topology checks cannot infer design intent perfectly. The full-bleed example exposes that ambiguity directly.
- JPEG output can retain faint flecks or edge halos, particularly on black. These are explicitly accepted under the requested practical quality tolerance.
- A previously accepted wide wordmark can now be refused by the interior-detail check. This is a coverage regression; the total improvement does not mean every individual case improves.
- Matching transparent-source recovery deliberately requires reliable existing family metadata. It does not fetch speculative alternatives or rerun website discovery.

## Evidence and reproduction

[Final measurements](background-removal-quality/v2-results.json), [original42 independent visual QA](background-removal-v2-final-qa.json), [additional18 independent visual QA](background-removal-fresh-v2-final-qa.json), and [historical10/42 baseline](background-removal-quality/all-42-worker-results.json).

The additional18 examples were frozen before their first inference. Initial independent QA then exposed issues used to improve generic guards. Their final results therefore constitute regression verification after that feedback, not an untouched held-out estimate.

Run after explicit model setup:

```sh
node scripts/experiments/background-removal-v2.mjs
node scripts/experiments/background-removal-v2-gallery.mjs
npm run check
```

The evaluator saves predictions by input SHA-256, including retry views. Add `--replay` to reuse these for deterministic postprocessing experiments; replay timings must not be presented as inference timings. All 60 returned canvases were checked for unchanged dimensions; refused transformations were checked for byte-identical original return values. Review PNGs re-encode those originals for display only.

Repository verification: 380 tests passed, frozen fixture validation passed, syntax checks passed, and the local homepage/docs/API smoke test passed. Coverage includes disabled/no-runtime behavior, explicit setup integrity, offline processing, hosted rejection, worker failures/lifecycle/concurrency, transparency/vector skips, PNG downloads, retry bounds, same-family recovery, duplicate inference reuse and removal before upscaling.
