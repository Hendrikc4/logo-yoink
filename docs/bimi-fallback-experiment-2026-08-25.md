# BIMI icon fallback experiment — 2026-08-25

## Decision

Retain BIMI behind the explicit `bimi: true` / CLI `--bimi` option. Do not enable it in the default runtime. The frozen rule produced four correct, role-appropriate selections across development and validation with zero wrong-brand admissions, but every one replaced an already-correct cached favicon. Incremental correct selection yield was therefore zero, below the repository's promotion gate.

BIMI is treated as a domain-controlled self-assertion, not as a certificate-verified or license-cleared asset. The optional `a=` pointer is preserved, but certificate validation is explicitly `not_performed`; the code never claims trademark or license permission.

## Frozen rule

- Query only `default._bimi.<normalized-domain>`. The extractor does not guess public-suffix boundaries; a caller may supply a PSL-derived organizational domain explicitly, and it must contain the requested domain.
- Require exactly one `v=BIMI1` TXT assertion, tolerate split TXT chunks and tag whitespace/casing, reject ambiguous records and duplicate tags, and require a nonempty HTTPS `l=` URL.
- Bound DNS to 2 seconds by default and cache at most 512 stable outcomes for 15 minutes. Resolver errors and timeouts are not cached.
- Fetch the SVG through the existing public-address/DNS, redirect-revalidation, timeout, response-size, byte-budget, MIME, and image-validation path. Additionally reject active, animated, externally referenced, or document-dependent SVG content.
- Run after the existing eligible first-party static/deep/browser recovery gates and before the built-in Google or DuckDuckGo cached favicon fallbacks. Optional Besticon retains its existing budgeted position because it was disabled in the frozen experiment. If BIMI and the cached favicon both abstain, the existing Jina screenshot gate may still run; BIMI itself does not trigger an additional icon-only browser crawl or Jina screenshot. Never displace an existing canonical icon.
- Restrict BIMI to icon/favicon roles. It can never produce `assets.logo` / wide. Canonical icon admission requires a measured square canvas and a measured content ratio below 1.8; unmeasurable artwork abstains.

## Live results

All-domain prevalence used the frozen major-brands split files. Development had BIMI on 46/180 domains (25.56%); 44 SVGs were retrievable and safe-valid. Validation had BIMI on 26/60 (43.33%); 25 were retrievable and safe-valid. The prevalence pass cost 240 DNS queries, 74 HTTP requests, and 199,323 downloaded bytes in total. Development latency was p50 52 ms / p95 383 ms; validation was p50 63 ms / p95 272 ms.

The runtime-gated development pair queried BIMI only for 18 of 133 reachable icon-missing cases. Five safe SVGs were retrieved. Visual review found Cisco and Lowe's to be correct-brand but wide lockups padded onto square BIMI canvases, prompting the generic content-shape iteration. The frozen rerun admitted Workday, Adobe, and Nvidia: 3/3 correct, 100% strict precision, zero wrong-brand, but zero incremental correct selections because the control's cached icons were already correct. Gated cost was 18 DNS + 5 HTTP requests, 8,177 bytes, and BIMI-stage p50 68 ms / p95 414 ms.

One-shot validation admitted Salesforce: 1/1 correct, zero wrong-brand, and again zero incremental correct selections over its correct cached icon. Gated cost was 4 DNS + 2 HTTP requests (one redirect), 912 bytes, and p50 22 ms / p95 99 ms. Unrelated live reachability varied between paired crawls, so aggregate crawl coverage and wall-clock differences are not attributed to BIMI; the per-domain BIMI diagnostics are the cost surface used here.

After the rule was frozen, direct non-scoring controls observed Apple with an accepted default assertion and Google, Nike, and Pepsi with no default assertion. In the actual fallback run Apple was not queried because a stronger first-party icon already existed; Pepsi was queried and abstained. Google and Nike are evaluation-split entities and were not used for tuning or scored.

## Follow-up ordering audit

The follow-up compared the four selections that actually changed when BIMI was placed before the configured Google and DuckDuckGo caches. Besticon was disabled in the frozen runs, so it contributed no selection or latency changes to inspect; the runtime keeps its existing budgeted discovery position, unchanged by `--bimi`. Workday, Adobe, Nvidia, and Salesforce each remained a correct-brand, correct-role icon, so correct-role coverage stayed 4/4 and wrong-brand selections stayed at zero. All four selections changed from third-party cached rasters to domain-controlled, self-asserted SVGs; none was certificate-validated.

That is a provenance and scalability improvement, not a correctness improvement. Mean tiny-render suitability changed from 97.825 to 96.650 (-1.175): one candidate improved, one was unchanged, and two worsened. The combined gated cost across development and validation was 22 DNS requests, 7 HTTP requests, 9,089 bytes, and BIMI-stage latency of 58 ms p50 / 203 ms p95 / 414 ms maximum. This bounded cost is acceptable for the opt-in mode, but the lack of incremental correct-role coverage and mixed tiny-render quality do not justify enabling BIMI by default merely because its provenance is first-party.

The audit also found and fixed generally applicable defects: injected DNS resolvers no longer share the process-global system-resolver cache; cached results are copied before return; organizational-domain fallback counts both DNS attempts; IP literals abstain safely at runtime; the parser requires `v=` to be the first tag; API/demo option plumbing now exposes the same explicit opt-in; safety validation no longer claims BIMI SVG profile conformance; and benchmark configs record both dirty-worktree state and a reproducible worktree snapshot digest.

An independent Claude Opus 5 review then traced the full ranking and retrieval paths. It found that the first shape iteration failed open for intrinsically wide SVG canvases or unmeasurable artwork, that favicon deferral could accidentally enable an unrelated Jina screenshot, that transient DNS failures were cached for 15 minutes, and that HTTP request metrics included DNS lookups. The generally applicable fixes now require a measured, square canvas and non-wide measured artwork for BIMI canonical-icon admission; run the Jina path only after both BIMI and the normal cached favicon abstain; avoid caching resolver errors/timeouts; apply the inert-SVG check before claiming SVG safety for every source; record Jina availability in future benchmark configs; and report DNS separately from HTTP requests. The review also showed that Besticon ordering had no evidence because it was disabled in every frozen run, so its existing position was restored rather than promoted on provenance alone.

## Reproduction

```sh
npm ci
node --test test/bimi.test.mjs test/bimi-ordering-audit.test.mjs \
  test/demo-security.test.mjs test/extractor.test.mjs test/benchmark.test.mjs

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

The changed-selection audit is deterministically derived from fingerprint-bound, sanitized evidence:

```sh
audit_dir=$(mktemp -d)
node scripts/experiments/bimi-ordering-audit.mjs \
  --input reports/bimi-fallback-2026-08-25/ordering-inputs.json \
  --output "$audit_dir/ordering-audit.json"
diff -u reports/bimi-fallback-2026-08-25/ordering-audit.json \
  "$audit_dir/ordering-audit.json"
```

Compact machine metrics and fingerprint-bound judgments are in `reports/bimi-fallback-2026-08-25/`. The original raw live runs remain in ignored `runs/`; their recorded config hashes are preserved in the sanitized ordering inputs. Future benchmark configs also include a worktree snapshot digest, so evidence produced from a dirty tree can be tied to its exact source bytes. The canonical split/fixture inputs remain unchanged.

## Remaining risks

- Certificate/VMC/CMC chain and policy validation is not implemented. An `a=` URL is provenance only.
- No license or trademark permission follows from DNS control or an unvalidated evidence pointer.
- DNS promises cannot be cancelled after the caller's timeout; the extractor stops awaiting them, but the underlying resolver may finish later.
- Registrable-domain fallback requires an explicitly supplied organizational domain because the project has no public-suffix-list dependency.
- No shipped CLI/API option currently supplies an organizational domain; that fallback is available only to direct library callers.
- The frozen runs had Besticon disabled and did not record Jina availability. The measured 22-DNS/7-HTTP cost describes the BIMI stage, not an untested Besticon configuration; future configs now record Jina state.
- The sanitized audit deterministically recomputes metrics from fingerprint-bound reviewed pairs, but the ignored raw live runs remain the source for asserting that the four-pair change set was exhaustive.
- Live DNS and assets can change after this dated experiment. The frozen hashes identify inputs and reviewed bytes, not future network state.
