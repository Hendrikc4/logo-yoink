# 500-Company Visual Logo Benchmark Plan

Status: proposed  
Dataset source: [`fixtures/companies-500.json`](../fixtures/companies-500.json)  
Purpose: build reproducible visual ground truth for discovery and ranking improvements without using a paid logo kit

## 1. Objective

Build a benchmark that answers four separate questions for each of the 500 company websites:

1. **Was the current company identity reachable and unambiguous?**
2. **Which company logos were visibly used on the rendered site?**
3. **Which underlying files or inline elements produced those visible logos?**
4. **Did Logo Yoink discover and rank the best usable asset for each role?**

The benchmark must distinguish discovery failure from ranking failure. A full-page screenshot can prove that a wordmark is visible, but it cannot by itself identify the source URL or explain why the extractor missed it. Each visual observation therefore needs a DOM/network mapping to a candidate asset.

The output should improve an interpretable ranker, not become a manually curated logo API. The reusable product is the capture pipeline, evidence schema, labels, and evaluation protocol.

## 2. What already exists

The repository already provides:

- 500 stable company records with `entity_id`, company name, website, and historical cohort;
- static and rendered-browser discovery;
- content-addressed candidate assets and stable candidate IDs;
- separate `icon`, `wide`, and `favicon` roles;
- score reasons, confidence bands, reachability taxonomy, and network metrics;
- light/dark review montages and interactive contact sheets;
- label building, label transfer, reranking, run comparison, and scoring scripts;
- historical development, holdout, and remaining-300 benchmark runs.

The missing layer is exhaustive visual ground truth. Existing reviews primarily judge selected candidates. They do not consistently record every visible logo instance, the exact element/file that produced it, or a best available asset that the extractor failed to retain.

## 3. Benchmark principles

### 3.1 Separate capture, labeling, ranking, and evaluation

Capture the web once into an immutable run. Label that frozen run. Rerank the frozen candidate/feature data repeatedly without revisiting live pages. This prevents website drift from being confused with algorithm improvement.

### 3.2 Keep safety vetoes separate from relevance scoring

SSRF protection, active-SVG rejection, byte/pixel limits, and explicit identity conflicts remain hard safety controls. Candidate relevance, shape, placement, and usability belong in the ranker. A ranker experiment must not weaken network or content security to gain recall.

### 3.3 Label candidates, not only winners

For each reachable entity, label all plausible brand candidates plus a bounded set of hard negatives. This supports candidate recall, top-1 ranking, pairwise ranking, and false-positive analysis.

### 3.4 Preserve abstention

The correct result can be “no defensible icon” or “no graphic wordmark.” Coverage must never be improved by forcing an unrelated asset into a role.

### 3.5 Keep the final evaluation sealed

GPT-Luna workers may collect and label the evaluation shard, but ranker-development tasks must not receive those labels before the ranker and thresholds are frozen. Because portions of the historical holdout have already appeared in prior reviews, results must clearly state that the 500-company set is a product benchmark, not a pristine research-grade unseen test set. A future release should add a new sealed cohort.

## 4. Dataset layout

Create a versioned, immutable capture root:

```text
runs/visual-benchmark-v1/
  manifest.json
  entities.jsonl
  candidates.jsonl
  visual-instances.jsonl
  mappings.jsonl
  captures/
    <entity_id>/
      page.json
      desktop-light-top.png
      desktop-light-full-001.png
      desktop-dark-top.png
      mobile-light-top.png
      overlays/
      element-crops/
  assets/
    <sha256>.<ext>
  shards/
    capture-00.jsonl
    labels-00.jsonl
  reports/
```

Keep downloaded images, HTML, screenshots, and browser traces ignored by Git. Commit the capture schema, scripts, run manifest, labels that are safe to redistribute, and aggregate reports. The public dataset should default to metadata, hashes, source URLs, and labels—not third-party image bytes or full website screenshots. Anyone can reproduce the visual artifacts locally.

Every record must include:

- schema and capture version;
- extractor/ranker Git revision and dirty-tree fingerprint;
- entity ID, requested website, fixture name, and shard;
- UTC capture timestamp;
- final URL and reachability category;
- browser engine/version, viewport, theme, user agent, and capture flags;
- content hashes for HTML, screenshots, and downloaded assets;
- request count, bytes, duration, truncation, and resource-limit diagnostics.

## 5. Capture protocol

### 5.1 Static pass

Run the broadest safe static discovery mode and retain candidates before final role eligibility. Record candidates excluded by download budget, validation, deduplication, generic-asset filters, role eligibility, or rank threshold with structured rejection reasons.

Capture:

- parsed `img`, `picture/source`, inline SVG, favicon, manifest, structured data, and selected CSS sources;
- declared dimensions and `srcset` descriptors;
- DOM region, ancestry summary, home-link state, semantic tokens, and company-identity hints;
- canonical and resolved URL, HTTP status, content type, byte count, content hash, intrinsic dimensions, and content bounds;
- evidence merged across duplicate URLs and duplicate bytes.

### 5.2 Rendered pass

Use one pinned Chromium/Playwright version and a deterministic capture configuration.

Default views:

| View | Viewport | Theme | Purpose |
|---|---:|---|---|
| Desktop | 1440×1000 | light | Primary header/navigation and full-page mapping |
| Desktop | 1440×1000 | dark | Theme-swapped brand assets |
| Mobile | 390×844 | light | Responsive logo variants and mobile navigation |

For each view:

1. navigate with a bounded timeout and request/byte budget;
2. wait for DOM content, fonts/layout stabilization, and a short bounded hydration window;
3. capture the top viewport before scrolling;
4. scroll in viewport-sized increments to trigger bounded lazy loading;
5. return to the top and capture sticky/header state again;
6. capture a tiled full-page screenshot with a maximum total height rather than one unmanageably tall bitmap;
7. inspect every visible `img`, `picture`, SVG, CSS background, CSS mask, and relevant pseudo-element in trusted regions;
8. record its bounding box, visibility, computed style, ancestor context, link target, current source, and network response;
9. save a tight element crop and a numbered overlay screenshot showing where it appeared;
10. serialize safe inline SVGs with computed colors and referenced local definitions.

The capture should also record text-only brand treatments. These are valid evidence that a graphic wordmark does not exist, but they are not assets to synthesize or return.

### 5.3 Candidate-to-visual mapping

Map a discovered asset to a rendered instance using this order:

1. exact current/resolved URL;
2. exact byte hash;
3. inline SVG normalized hash;
4. browser element identity captured during inspection;
5. conservative perceptual match on light and dark composites, used only as a diagnostic suggestion.

Record `exact`, `derived`, `suggested`, or `unmapped`. Do not silently treat a screenshot crop as the original downloadable logo.

### 5.4 Failure and identity capture

Before labeling candidates, classify the site:

- live first-party identity;
- redirected to a current related identity;
- redirected off-domain;
- parked or for sale;
- expired, hijacked, or unrelated content;
- blocked/interstitial;
- DNS/TLS failure;
- incomplete/blank render;
- ambiguous identity.

Save a top-page screenshot for non-sensitive failures so an adjudicator can verify the category. Never bypass login, CAPTCHA, bot protection, or access controls.

## 6. Annotation schema

### 6.1 Entity-level label

```json
{
  "entity_id": "...",
  "identity_status": "current|related_rebrand|wrong_site|ambiguous|unreachable",
  "display_name": "Observed brand name",
  "graphic_logo_present": true,
  "text_only_brand_present": false,
  "notes": "..."
}
```

### 6.2 Visual-instance label

Each visible logo occurrence receives:

- `identity`: correct, wrong, ambiguous. For an exact candidate mapping this is
  inherited from that reviewer's candidate label in the same pass; the exported
  row records the exact mapping ID, candidate ID, and candidate-label ID in
  `identity_derivation` and does not ask for a second identity judgment;
- for non-exact or unmapped observations, the reviewer answers the concrete
  question “Is this a visible logo/brand mark of the requested company?” with
  `yes`, `no`, or `genuinely unclear`; export maps these deterministically to
  `correct`, `wrong`, and `ambiguous`;
- `visual_role`: symbol, wordmark, horizontal-lockup, stacked-lockup, favicon, social-card, badge, partner-logo, UI-control, content-image, or other;
- `region`: header, nav, body, footer, metadata, browser-chrome;
- `theme`: light, dark, both, unknown;
- `visibility`: good, conditional, unusable;
- `instance_box` and screenshot/crop references;
- `candidate_id` mapping and mapping confidence;
- `first_party`: yes, no, ambiguous;
- reviewer confidence and a short evidence note.

Region, theme, visibility, visual role, and mapping confidence come from the
frozen capture record. The review packet displays them as evidence and emits
them only when the reviewer records an override. A dedicated
`review_attestation` label confirms that the screenshots, numbered overlays,
and uncertain crops for the entity were reviewed and records the frozen visual
instance count.

### 6.3 Candidate-level label

Each plausible candidate and selected hard negative receives:

- identity correctness: correct, wrong, ambiguous;
- applicable roles: icon, wide, favicon, stacked/other;
- usability per light and dark background: good, conditional, unusable;
- quality defects: tiny, padded, cropped, blurry, blank, monochrome-only, theme-specific, screenshot/photo, stale brand, or composite content;
- provenance quality: visible exact use, structured first-party, inferred first-party, or unsupported;
- best-for-role: true/false for each role;
- reject reason when unusable or wrong.

The `wide` output remains a product role for a horizontal wordmark or horizontal lockup. Stacked marks should be labeled separately even if the current UI has no dedicated card; this prevents them from becoming unexplained false negatives.

### 6.4 Missing-role root cause

For every entity without a correct usable asset in a role, assign exactly one primary cause:

- no graphic asset exists;
- icon-only or stacked-only identity;
- asset visible but not discovered;
- discovered but not validated;
- removed by URL/byte dedupe;
- excluded by budget;
- rejected by identity/evidence filter;
- rejected by shape/quality rule;
- ranked below a worse candidate;
- theme serialization failure;
- page blocked/incomplete;
- identity unsafe/ambiguous.

## 7. Review interface

Extend the current contact-sheet tooling into an entity review packet containing:

1. company/URL/final-identity header;
2. desktop and mobile top screenshots;
3. tiled full-page screenshot or compact overview;
4. overlay screenshot with numbered visible instances;
5. each element crop beside its mapped candidate preview;
6. every plausible candidate on light and dark backgrounds;
7. current role scores, score reasons, source, dimensions, and rejection diagnostics;
8. explicit controls for entity, positive-first instance selection, candidate,
   complete `best_for_role`, review attestation, and missing-cause labels.

The interface saves reviewer/pass/run/capture-isolated JSONL drafts. Reviewer
defaults remain empty until entity attestation. At final export, selected
positive and unclear non-exact observations retain their explicit choices and
remaining non-exact detector observations serialize as `wrong`; this is an
audited negative only for instance coverage and never promotes irrelevant DOM
observations into candidate-ranker positives. Exact mappings export only after
the referenced candidate identity is present.

## 8. Labeling quality protocol

GPT-Luna is appropriate for first-pass visual classification and repetitive evidence recording, but it must not be the only authority.

- Every entity receives one primary Luna review.
- Every positive-first entity review ends with an attestation that the frozen
  screenshot/overlay evidence was reviewed. Agreement tooling requires the
  attestation for v3 passes, validates its instance count, reports it
  separately, and excludes bookkeeping fields from semantic denominators.
- A deterministic 20% overlap sample receives an independent second Luna review.
- Every wrong/ambiguous identity, low-confidence label, unmapped visible logo, selected-role change, and disagreement receives adjudication.
- A human or stronger-model coordinator reviews all proposed wrong-brand selections and all changes that would affect the ranker benchmark.
- Reviewers see only the frozen capture packet, not another reviewer's labels.
- Agreement is reported for identity, role, usability, and best-for-role using raw agreement and Cohen's kappa where applicable.
- Labels retain reviewer ID, model/version, prompt version, timestamp, confidence, and adjudication history.

Do not use a language model to infer that an invisible candidate is the logo merely because its filename contains `logo`. Visual and first-party page evidence remain authoritative.

## 9. Dataset splits and leakage control

Keep the historical cohort fields for comparison. Add a versioned `benchmark_split_v1` assigned by stable hash of `entity_id`, stratified after capture by reachability and baseline role availability:

- **Development: 300 entities.** Used for feature design, weight fitting, threshold tuning, and error analysis.
- **Validation: 100 entities.** Used to choose between already-defined experiments; no per-site tuning.
- **Evaluation: 100 entities.** Labels withheld from ranker-development tasks until code, weights, and thresholds are frozen.

No candidate from one entity may cross splits, including byte-identical assets. Duplicate-byte families spanning companies are diagnostic leakage groups and should be assigned or evaluated together where feasible.

After the first evaluation, publish all labels if desired and create a new external holdout for future development. Never continue calling a released and repeatedly inspected split “unseen.”

## 10. Metrics

### 10.1 Discovery metrics

- visible-instance recall;
- candidate recall by icon, wide, favicon, and stacked role;
- exact asset mapping rate;
- correct candidate retained before and after validation, dedupe, and budget;
- missing-role root-cause distribution;
- recall by source type, framework, theme, viewport, and rendering requirement.

### 10.2 Ranking metrics

- top-1 correct identity per role;
- top-1 usable asset per role on light and dark;
- recall@1, recall@3, mean reciprocal rank, and NDCG by role;
- best-candidate regret: score gap between selected and labeled best;
- coverage at confidence thresholds;
- abstention precision and wrong-brand rate;
- calibration: predicted confidence versus observed correctness.

### 10.3 Operational metrics

- p50/p95 latency;
- requests and downloaded bytes per domain;
- browser invocation rate;
- timeout/resource-limit rate;
- capture storage per domain;
- incremental correct wins per 100 browser invocations.

The primary product gate should require both improved usable coverage and no material degradation in wrong-brand safety. Raw availability alone is not a success metric.

## 11. Ranker-development approach

### Phase A: measure the ceiling

Calculate candidate recall before changing ranking. If the best logo is not in the retained candidate set, ranking work cannot fix it. Prioritize discovery, validation, dedupe, and budgeting by measured missing-cause prevalence.

### Phase B: create a feature table

For every candidate-role pair, export only deterministic features available at extraction time:

- source and provenance strength;
- header/nav/footer/body placement;
- home-link and repeated-use evidence;
- company/domain/site-name agreement;
- positive and negative semantic tokens;
- intrinsic and rendered dimensions, aspect ratio, content-box ratio, padding, alpha, and format;
- byte size, scalability, and theme evidence;
- duplicate family evidence;
- validation and identity-conflict flags.

Do not train on reviewer notes, screenshot-only judgments, candidate rank, or labels derived after extraction.

### Phase C: improve the interpretable baseline

Start with the existing rule-based scorer. Use labeled error slices to change one feature family at a time. Each experiment must produce:

- a hypothesis and expected affected slice;
- development and validation deltas;
- changed-selection list with visual review;
- wrong-brand and abstention changes;
- cost changes;
- keep/reject decision in the experiment log.

### Phase D: fit a constrained model only if justified

If manual weights plateau, fit a small role-specific logistic or pairwise linear model. Keep hard safety vetoes outside the model. Use grouped entity splits, regularization, class weighting, and probability calibration. Export human-readable coefficients and compare against the rule baseline.

Do not begin with a large vision model or end-to-end screenshot classifier. The dataset is too small, the decisions need provenance, and most failures are deterministic discovery/evidence problems.

### Phase E: freeze and evaluate

Freeze code, feature definitions, coefficients, thresholds, and capture policy before revealing evaluation labels. Run exactly once, report all metrics and changed selections, then document whether the version ships.

## 12. GPT-Luna Codex task topology

Use separate Codex tasks with `gpt-5.6-luna` for bounded grunt work. A coordinator owns schemas, merging, and final decisions.

### Stage 0: infrastructure tasks

1. **Capture-tool task:** implement deterministic screenshots, overlays, DOM/network mapping, and structured rejection logging.
2. **Review-interface task:** extend contact sheets for instance/candidate labels and incremental JSONL output.
3. **Schema/validator task:** define JSON Schemas, shard validation, stable IDs, completeness checks, and merge tooling.

These tasks should be integrated and tested before any 500-site capture begins.

### Stage 1: capture tasks

Create ten Luna tasks, each assigned exactly 50 entities by a committed shard manifest. Each task runs the same frozen capture command and writes only its assigned shard directory. Capture workers do not change extractor or ranker code.

Run no more than two browser-heavy capture tasks concurrently on one machine. Use per-domain rate limits, bounded retries, and checkpointing so interrupted tasks resume without recapturing completed entities.

### Stage 2: primary annotation tasks

Create ten Luna tasks, again 50 entities each. Give each task:

- the immutable review packets for its shard;
- the annotation guide and examples;
- an exact output path;
- permission to label only, not edit code or ranker behavior;
- a requirement to flag uncertainty rather than guess.

### Stage 3: independent QA tasks

Create five Luna tasks covering the deterministic 20% overlap sample, disagreements, all missing-wide cases, and all proposed wrong/ambiguous identities. They receive no primary labels until after submitting their own labels.

### Stage 4: adjudication and assembly

Use one stronger coordinator task, optionally assisted by two Luna evidence-check tasks, to resolve disagreements and validate mappings. Then run one assembly task to merge shards, enforce schema/completeness constraints, compute agreement, and generate the frozen dataset manifest.

### Stage 5: ranker experiments

Create separate Luna tasks for independent, non-overlapping hypotheses such as:

- evidence merging and duplicate families;
- semantic/home-link/company agreement;
- shape and content-bound scoring;
- budget and validation recall;
- browser-only and theme-specific candidates;
- confidence calibration and abstention.

Each task receives development labels only, writes a standalone experiment report, and must not modify the shared baseline directly. A coordinator selects clean experiments for integration, reruns the suite, and evaluates the combined candidate on validation.

### Example task contract

```text
You own visual-benchmark-v1 shard 03 only. Do not edit extractor, ranker,
fixtures, schemas, or another shard. Review every supplied entity packet using
the committed annotation guide. Write labels to the exact shard output path,
run the shard validator, and report incomplete or ambiguous entities. Do not
infer a logo from its filename alone. When uncertain, label ambiguous and add
a concise evidence note. Do not browse live sites; use only the frozen packet.
```

### Merge rules

- one entity belongs to one capture shard and one primary-label shard;
- workers write disjoint paths;
- no generated binaries are committed;
- shard output must validate before merge;
- the coordinator never resolves conflicts by taking “the latest” file;
- reruns retain prior records and append an explicit superseding annotation;
- task model, prompt version, and task/thread ID are recorded in provenance.

## 13. Implementation milestones

### Milestone 1: 20-company pilot

Select a stratified pilot containing static sites, SPAs, inline SVGs, raster wordmarks, CSS assets, light/dark variants, redirects, a parked domain, and known difficult examples such as Hoshii and Plug and Play.

Acceptance criteria:

- every visible header logo has a numbered overlay and crop;
- at least 95% of visible graphic logo instances map exactly to a candidate or receive a documented unmapped reason;
- capture reruns are content-addressed and resumable;
- two reviewers can label the same packet without schema questions;
- no active SVG or unsafe URL is rendered directly in the review interface.

### Milestone 2: 100-company development capture

Run the complete pipeline on the current development cohort. Refine schemas and instructions only here. Measure annotation time, disagreement, storage, network cost, and root-cause prevalence.

### Milestone 3: freeze protocol and capture remaining 400

Freeze capture version, prompt, schemas, and split manifest. Any later capture change creates a new version; it must not silently alter existing records.

### Milestone 4: baseline and ranker iterations

Produce baseline discovery/ranking metrics, then run isolated experiments. Require visual review of every changed top-1 selection.

### Milestone 5: sealed evaluation and release

Freeze the candidate ranker, reveal evaluation labels, score once, write the final report, and package the redistributable dataset metadata plus reproduction scripts.

## 14. Required tooling changes

Add or extend scripts for:

- deterministic shard generation;
- full visual capture and checkpointed browser scraping;
- DOM/network candidate mapping;
- overlay and element-crop generation;
- structured rejection logging;
- exhaustive review-packet generation;
- annotation JSON Schema and validation;
- overlap/disagreement generation;
- canonical overlap-agreement reports (`npm run visual-benchmark:agreement -- --run … --reviewer-a … --reviewer-b …`), with exact comparison for structured fields and Cohen's kappa only for categorical scalars;
- positive-first review exports with exact-mapping identity inheritance,
  deterministic yes/no/unclear serialization, capture-field override controls,
  and reviewer-scoped attestation;
- shard merge and adjudication history;
- candidate-role feature export;
- frozen reranking without network access;
- per-slice metrics and confidence calibration;
- changed-selection review packets.

Prefer JSONL for appendable records and content hashes for large artifact identity. All commands must accept explicit input/output paths and refuse to overwrite a completed frozen run unless `--resume` is supplied.

## 15. Risks and controls

| Risk | Control |
|---|---|
| Live-site drift | One immutable capture per dataset version; rerank offline |
| Wrong current identity | Entity-level identity label before candidate labels |
| Screenshot proves appearance but not source | DOM/network mapping plus exact hashes |
| Luna hallucinated labels | Frozen packets, empty defaults, overlap review, adjudication |
| Holdout leakage | Withhold evaluation labels from ranker tasks |
| Paid-kit behavior recreated manually | Learn general features; never add per-company ranking exceptions |
| Excessive crawl load | Two browser workers, rate limits, bounded retries, caching |
| Copyright/storage concerns | Do not publish third-party bytes/screenshots by default |
| Unsafe SVG or URL | Existing validation and SSRF controls; rasterized review previews |
| Coverage gained through false positives | Wrong-brand and abstention gates |
| Workers conflict in Git | Committed shard manifest and disjoint output paths |

## 16. Definition of done

The benchmark is complete when:

- all 500 entities have validated capture records or explicit failure records;
- every reachable entity has entity-level identity and graphic/text-only labels;
- all plausible candidate assets and visible logo instances are labeled;
- visual instances are mapped to candidate assets or have an explicit unmapped reason;
- overlap review and adjudication are complete and agreement is reported;
- development, validation, and sealed evaluation splits are frozen;
- baseline discovery ceiling, ranking quality, safety, calibration, and cost metrics are reproducible;
- every ranker change is linked to a labeled error slice and changed-selection review;
- the public repository can reproduce the benchmark without distributing third-party logo bytes;
- final documentation clearly separates measured correctness from automated availability.

## 17. Recommended first action

Do not immediately launch 20 annotation tasks. First create the 20-company pilot and make one review packet excellent. Once the schema, overlay mapping, and labeling controls survive two independent reviews, freeze the protocol and fan out capture and annotation to GPT-Luna tasks.

## 18. Execution record

Execution began on 2026-08-23. Stage 0 now includes deterministic shard generation, a resumable Playwright capture worker, structured candidate/visual/mapping/rejection evidence, a safe offline review packet, schema-aware validation, and distributed merge tooling.

The frozen pilot assignment lives in `benchmarks/visual-benchmark-v1-pilot/`. It contains 20 fixture companies in two disjoint 10-company capture shards, a 12/4/4 development/validation/evaluation split, and four deterministic overlap-review entities. Hoshii and Plug and Play remain external positive controls and are not allowed to contaminate the benchmark splits.

The pre-pilot gate is:

1. all repository tests and 500-fixture validation pass;
2. two workers sharing one immutable assignment digest write only their owned output directories;
3. interrupted capture resumes without duplicate or stale entity rows;
4. global view, pixel, instance, crop, request, and declared-byte limits produce explicit truncation evidence;
5. persisted URLs contain no credentials, query strings, or fragments;
6. raw untrusted SVG is never rendered by the review packet; a verified bounded raster preview is required;
7. reviewer, pass, run, and capture scope isolate drafts and label IDs while `target_key` remains stable for adjudication;
8. split files, nested shard labels, completeness, provenance, overlap adjudication, and cross-split byte families validate before merge.

Two infrastructure limits remain explicit rather than being hidden behind application-level checks: connection-time DNS-rebinding protection requires an egress firewall or resolver-pinning proxy, and a true transferred-byte ceiling requires a streaming proxy/body counter. Until those exist, captures are limited to the curated pilot domains, run with bounded requests/timeouts, and must not be described as safe for arbitrary untrusted URLs.

Pilot iteration results on 2026-08-23:

- The initial two GPT-Luna capture tasks found that duplicate top/tile observations exhausted the instance budget. Incremental stable-key deduplication fixed that false truncation.
- A second calibration separated noncritical crop-preview truncation from missing visual metadata. Crop-only caps now retain a successful capture plus an explicit `cropEvidenceTruncated` diagnostic.
- The selected pilot envelope is 200 requests, 25 MiB declared transfer, 240 unique cross-view observations, 96 crops, four 1,000-pixel tiles, and a 15-second page timeout. It produced 13 complete captures, six honest request/instance-truncated captures with retained evidence, and one DNS/TLS failure.
- The two worker roots merged into 6,471 schema-valid assignment/evidence records. The merger verified ownership and assignment digests and materialized every referenced candidate preview, screenshot, overlay, and crop.
- Visual inspection confirmed obvious candidate-discovery misses for DNA Chat and Planhat, correct-but-noisy first-party evidence for Amukha, and a small/padded horizontal identity for MY HEALTHY. These are now annotation/ranker cases rather than ad hoc one-site patches.
- Two independent primary Luna tasks produced 2,690 validated labels for all 20 entities; a blind overlap task produced 429 labels across four entities. Entity identity agreement was 100%, but candidate identity, candidate role, visual role, and missing-cause agreement were too low to freeze the protocol.
- The disagreement audit also found a schema problem: schema-valid reviewers could use hyphenated versus underscored value keys, incompatible candidate-role representations, and different `target_key` hashes for the same natural target. Canonical label normalization and adjudication are therefore required before the pilot can pass Milestone 1.
- Canonicalization now uses reviewer-independent natural target keys, reviewer-scoped label IDs, snake_case values, a canonical ordered `roles` array, and a complete five-role `best_for_role` map. The redundant singular `best_role` is accepted only as legacy migration input. All 3,119 original pilot labels migrate and validate, while the untouched raw exports remain under `reports/raw-labels/`.
- The stronger overlap adjudication resolved 407 disputed targets covering all 671 reported field differences. It confirmed a systemic primary-review error: broad DOM observations were being treated as company logos, while the blind QA pass sometimes overcorrected or collapsed applicability into a single role.
- A second blind two-reviewer round used the repaired contract and clearer instructions. It aligned all 429 targets. Candidate identity and `best_for_role` agreement reached 100%; light/dark usability reached 97.1% (kappa about 0.93). This is sufficient to continue refining candidate-ranker labels.
- Exhaustive visual-instance agreement still failed: identity was 44.2% (kappa 0.128), visual role was 65.2% (kappa 0.538), and missing-cause agreement was 70% (kappa 0.585). Most identity disagreements were `wrong` versus `ambiguous` on decorative SVG/CSS/image observations; another repeated error ignored an exact mapping to a known foreign candidate.
- Therefore Milestone 1 remains **blocked for annotation protocol quality**, not infrastructure. Do not launch the 500-company fan-out yet. The next iteration must make candidate identity authoritative for exact-mapped instances and replace exhaustive free-form DOM classification with a positive-first screenshot review: reviewers select the requested company's visible logo instances, explicitly mark plausible-but-unclear instances, and attest that the page was reviewed. Unselected UI, content, backgrounds, and partner marks are not ranker training positives. Exact-mapped instances inherit candidate identity; only unmapped/uncertain logo-like observations require separate identity review.
- The round-three tooling implements that positive-first protocol without
  changing historical label IDs: the stable label-ID namespace remains
  `visual-review-packet-v2`, while workflow provenance and draft isolation use
  `visual-review-packet-v3-positive-first`. Exact-derived rows carry mapping,
  candidate, and same-scope candidate-label references; the validator rejects
  mapping, reviewer/pass, or identity mismatches only for these new rows, so
  legacy pilot rows remain valid. Non-exact decisions use explicit
  yes/no/genuinely-unclear controls; capture classifications are optional
  overrides; attested export completes unselected detector observations as
  canonical `wrong`. Raw SVG remains excluded in favor of verified bounded
  raster previews. Agreement validates v3 attestation separately and keeps it
  out of semantic agreement denominators.

The next packet generation iteration is `visual-review-packet-v4-ranker-safe`.
It preserves `LABEL_ID_VERSION=visual-review-packet-v2` and all historical raw
exports, while adding a future-label safety gate for candidate identity, role
eligibility, theme usability, evidence-defect vocabulary, and same-scope
positive-first missing-role causes. Generate it in a new directory with no
prefilled judgments:

```sh
node scripts/visual-review-packet.mjs \
  --run runs/visual-benchmark-v1-pilot-v3/merged \
  --output runs/visual-benchmark-v1-pilot-v3/merged/review-packets-v4-ranker-safe \
  --overlap \
  --workflow-version visual-review-packet-v4-ranker-safe
```

The v4 gate is enforced on export and strict validation only when row
provenance names that workflow. Migration, attestation, exact-mapping
inheritance, SVG-safe previews, draft isolation, and historical agreement
behavior remain unchanged.

Pilot scale-up gate after that change:

1. candidate identity and theme-usability raw agreement are at least 95%, with identity kappa at least 0.90;
2. every visible requested-company header/footer logo is selected or documented as missed, and exact candidate mappings propagate identity without contradiction;
3. positive/unclear visual-selection agreement is at least 95%; irrelevant detector observations are excluded from the semantic agreement denominator;
4. missing-role agreement is at least 90%, and every `asset_visible_not_discovered` decision cites a screenshot/overlay instance;
5. all strict schema, coverage, artifact, ownership, and split validations pass before freezing the 100-company development run.
