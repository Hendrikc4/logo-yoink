# BIMI icon fallback experiment — 2026-08-25

## Decision

Retain BIMI behind the explicit `bimi: true` / CLI `--bimi` option. Do not enable it in the default runtime. The frozen rule produced four correct, role-appropriate selections across development and validation with zero wrong-brand admissions, but every one replaced an already-correct cached favicon. Incremental correct selection yield was therefore zero, below the repository's promotion gate.

BIMI is treated as a domain-controlled self-assertion, not as a certificate-verified or license-cleared asset. The optional `a=` pointer is preserved, but certificate validation is explicitly `not_performed`; the code never claims trademark or license permission.

## Frozen rule

- Query only `default._bimi.<normalized-domain>`. The extractor does not guess public-suffix boundaries; a caller may supply a PSL-derived organizational domain explicitly, and it must contain the requested domain.
- Require exactly one `v=BIMI1` TXT assertion, tolerate split TXT chunks and tag whitespace/casing, reject ambiguous records and duplicate tags, and require a nonempty HTTPS `l=` URL.
- Bound DNS to 2 seconds by default and cache at most 512 outcomes for 15 minutes.
- Fetch the SVG through the existing public-address/DNS, redirect-revalidation, timeout, response-size, byte-budget, MIME, and image-validation path. Additionally reject active, animated, externally referenced, or document-dependent SVG content.
- Run only after stronger first-party/static/deep/browser/Jina icon recovery is exhausted and before third-party favicon caches. Never displace an existing canonical icon.
- Restrict BIMI to icon/favicon roles. It can never produce `assets.logo` / wide. Measure nontransparent artwork; a content ratio of 1.8 or wider is a padded wordmark and cannot become the canonical icon.

## Live results

All-domain prevalence used the frozen major-brands split files. Development had BIMI on 46/180 domains (25.56%); 44 SVGs were retrievable and safe-valid. Validation had BIMI on 26/60 (43.33%); 25 were retrievable and safe-valid. The prevalence pass cost 240 DNS queries, 74 HTTP requests, and 199,323 downloaded bytes in total. Development latency was p50 52 ms / p95 383 ms; validation was p50 63 ms / p95 272 ms.

The runtime-gated development pair queried BIMI only for 18 of 133 reachable icon-missing cases. Five safe SVGs were retrieved. Visual review found Cisco and Lowe's to be correct-brand but wide lockups padded onto square BIMI canvases, prompting the generic content-shape iteration. The frozen rerun admitted Workday, Adobe, and Nvidia: 3/3 correct, 100% strict precision, zero wrong-brand, but zero incremental correct selections because the control's cached icons were already correct. Gated cost was 18 DNS + 5 HTTP requests, 8,177 bytes, and BIMI-stage p50 68 ms / p95 414 ms.

One-shot validation admitted Salesforce: 1/1 correct, zero wrong-brand, and again zero incremental correct selections over its correct cached icon. Gated cost was 4 DNS + 2 HTTP requests (one redirect), 912 bytes, and p50 22 ms / p95 99 ms. Unrelated live reachability varied between paired crawls, so aggregate crawl coverage and wall-clock differences are not attributed to BIMI; the per-domain BIMI diagnostics are the cost surface used here.

After the rule was frozen, direct non-scoring controls observed Apple with an accepted default assertion and Google, Nike, and Pepsi with no default assertion. In the actual fallback run Apple was not queried because a stronger first-party icon already existed; Pepsi was queried and abstained. Google and Nike are evaluation-split entities and were not used for tuning or scored.

## Reproduction

```sh
npm ci
node --test test/bimi.test.mjs test/extractor.test.mjs test/benchmark.test.mjs

node scripts/experiments/bimi-prevalence.mjs \
  --split development \
  --output runs/bimi-prevalence-development.json \
  --concurrency 8 --timeout-ms 2000

npm run benchmark -- --cohort major-brands-300 --split development \
  --output runs/bimi-control-development --concurrency 8 --timeout-ms 10000
npm run benchmark -- --cohort major-brands-300 --split development \
  --output runs/bimi-treatment-development --concurrency 8 --timeout-ms 10000 --bimi

# Freeze the rule before these validation commands.
node scripts/experiments/bimi-prevalence.mjs \
  --split validation \
  --output runs/bimi-prevalence-validation.json \
  --concurrency 8 --timeout-ms 2000
npm run benchmark -- --cohort major-brands-300 --split validation \
  --output runs/bimi-control-validation --concurrency 8 --timeout-ms 10000
npm run benchmark -- --cohort major-brands-300 --split validation \
  --output runs/bimi-treatment-validation --concurrency 8 --timeout-ms 10000 --bimi

npm run check
```

Compact machine metrics and fingerprint-bound judgments are in `reports/bimi-fallback-2026-08-25/`. Raw live runs remain in ignored `runs/` and the canonical split/fixture inputs remain unchanged.

## Remaining risks

- Certificate/VMC/CMC chain and policy validation is not implemented. An `a=` URL is provenance only.
- No license or trademark permission follows from DNS control or an unvalidated evidence pointer.
- DNS promises cannot be cancelled after the caller's timeout; the extractor stops awaiting them, but the underlying resolver may finish later.
- Registrable-domain fallback requires an explicitly supplied organizational domain because the project has no public-suffix-list dependency.
- Live DNS and assets can change after this dated experiment. The frozen hashes identify inputs and reviewed bytes, not future network state.
