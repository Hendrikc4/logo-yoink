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

- `identity`: correct, wrong, ambiguous;
- `visual_role`: symbol, wordmark, horizontal-lockup, stacked-lockup, favicon, social-card, badge, partner-logo, UI-control, content-image, or other;
- `region`: header, nav, body, footer, metadata, browser-chrome;
- `theme`: light, dark, both, unknown;
- `visibility`: good, conditional, unusable;
- `instance_box` and screenshot/crop references;
- `candidate_id` mapping and mapping confidence;
- `first_party`: yes, no, ambiguous;
- reviewer confidence and a short evidence note.

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
8. explicit controls for entity, instance, candidate, best-role, and missing-cause labels.

The interface must save JSONL incrementally and validate required fields. Reviewer defaults must be empty; the existing “everything is correct unless listed as an override” convention is too risky for exhaustive ground truth.

## 8. Labeling quality protocol

GPT-Luna is appropriate for first-pass visual classification and repetitive evidence recording, but it must not be the only authority.

- Every entity receives one primary Luna review.
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
