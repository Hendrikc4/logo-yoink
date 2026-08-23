# 500-Company Candidate Logo Labeling Plan

Status: labeling workflow implemented; 500-company labeling not yet complete  
Dataset source: [`fixtures/companies-500.json`](../fixtures/companies-500.json)  
Tool: [`scripts/visual-label-sheets.mjs`](../scripts/visual-label-sheets.mjs)

## Goal

Create visual ground truth for every logo candidate scraped from the 500 company
websites. The labels should tell us:

- whether the image is actually a logo of the named company;
- which roles it can serve: `icon`, `wide`, `favicon`, or `stacked`;
- whether it works on a light background, a dark background, or both;
- which candidate is best for each role when several valid choices exist.

This phase is only about producing reliable labels efficiently. Do not change,
tune, or compare ranker behavior yet.

## Simple workflow

1. Run the existing scraper for the frozen company cohort and save
   `entities.jsonl`, `candidates.jsonl`, and the referenced candidate assets.
2. Generate batched, numbered PNG sheets from all saved candidates.
3. Give each sheet and the shared prompt to one AI reviewer.
4. Ask the reviewer to return candidate numbers in one compact JSON object.
5. Validate the responses and expand them into one label row per candidate.
6. Blind-review a deterministic 10–20% sample and resolve material
   disagreements.
7. Freeze the labels. Ranker optimization starts in a later phase.

The main review unit is a candidate image, not a DOM element. We do not need an
image-recognition call per asset, exhaustive visual-instance annotations,
candidate-to-DOM mappings, missing-role forms, or per-page attestations for this
labeling pass.

## Numbered sheets

Build a packet with:

```sh
node scripts/visual-label-sheets.mjs build \
  --run runs/visual-benchmark-v1 \
  --output runs/visual-benchmark-v1/label-sheets-v3 \
  --max-candidates 24 \
  --max-entities 4
```

Each PNG contains candidates from several companies. Every company group shows
the company name and website, and every candidate has a large number. The asset
is rendered on both white and dark backgrounds so one review can judge identity,
role, and theme usability at the same time.

The sheets deliberately hide current rank, selected status, predicted role,
scores, filenames, and score reasons. This prevents the reviewer from copying
the deterministic ranker's opinion.

Candidate order is stable and blind for a given seed. Identical bytes within one
company are shown once; the mapping retains all aliased candidate IDs so the
final decision can be expanded back to every scraped record. Assets are never
deduplicated across different companies. Missing or corrupt preview paths remain
numbered candidates and render as `preview unavailable`; they are never dropped
from the mapping. Sheets are capped at 24 visual tiles. A larger company is
split into numbered parts, while its best-per-role constraint remains global.

Default packet contents:

```text
label-sheets-v3/
  index.json
  sheets.jsonl
  prompt.md
  responses-template.jsonl
  sheets/
    sheet-0001-<hash>.png
    sheet-0002-<hash>.png
```

`index.json` is the authoritative mapping from each visible number to its
company, candidate ID aliases, content hash, and asset path.

## Compact AI response

The reviewer returns one JSON object per sheet and no prose:

```json
{
  "sheet_id": "sheet-0001-1234abcd",
  "packet_fingerprint": "sha256:<mapping-and-image-fingerprint>",
  "reviewed": true,
  "logos": [
    { "n": 2, "roles": ["icon", "favicon"], "works_on": ["light", "dark"] },
    { "n": 6, "roles": ["wide"], "works_on": ["light"] }
  ],
  "best": {
    "icon": [2],
    "wide": [6],
    "favicon": [2],
    "stacked": []
  },
  "uncertain": [11]
}
```

The response is positive-first:

- `logos` contains only real logos of the company named above that candidate;
- `uncertain` contains only genuinely ambiguous candidates;
- after `reviewed` is `true`, every omitted number becomes a negative;
- a candidate may have multiple roles;
- `works_on` must contain `light`, `dark`, or both;
- `best` contains at most one candidate per company for each role, and that
  candidate must already have the role in `logos`; this is enforced globally
  when a company is split across multiple sheets.
- `packet_fingerprint` must be copied from the response template and binds the
  response to both the frozen number mapping and exact rendered PNG bytes.

Role definitions:

- `icon`: a standalone symbol or mark;
- `wide`: a wordmark or horizontal symbol-plus-wordmark lockup;
- `favicon`: a mark that remains suitable at tiny browser-icon size;
- `stacked`: a vertically stacked logo lockup.

The reviewer judges the pixels, not the source metadata. A padded square file
whose visible content is a horizontal wordmark is still `wide`.

## Validation and expansion

Place completed JSON or JSONL responses in one file or directory, then run:

```sh
node scripts/visual-label-sheets.mjs validate \
  --packet runs/visual-benchmark-v1/label-sheets-v3 \
  --labels runs/visual-benchmark-v1/label-responses \
  --output runs/visual-benchmark-v1/candidate-labels.jsonl \
  --reviewer luna-primary-01 \
  --review-pass primary
```

Validation rejects:

- missing or duplicate sheet responses;
- unknown candidate numbers;
- a response that is not explicitly marked reviewed;
- duplicate, invalid, or conflicting positive/uncertain numbers;
- unknown roles or themes;
- best choices that are not positive for that role;
- more than one best candidate for the same company and role.

The validator then expands the compact decisions to one canonical
`visual-benchmark-v1` candidate `label` row for every original candidate ID,
including negatives and byte-identical aliases. It uses the benchmark's shared
normalization and stable label-ID helpers. Reviewer identity and review pass are
stamped from the import command; reviewer-supplied identity fields are rejected.
Output is written atomically and an existing file is replaced only when
`--overwrite` is explicit.

## Efficient 500-company execution

First run the complete capture and sheet builder once. Then divide the generated
sheet IDs among Codex/GPT-Luna labeling tasks. Each task receives:

- its assigned PNG sheets;
- the unchanged `prompt.md`;
- the corresponding entries from `index.json` only as number-to-record mapping;
- a disjoint output path for response JSONL;
- instructions to label only and not edit scraper or ranker code.

A practical assignment is 10–25 sheets per task, adjusted after measuring the
first batch. Tasks should checkpoint one JSON object per completed sheet so a
partial run can resume without repeating visual review.

The coordinator merges response files and runs the validator once. Do not merge
by “latest file wins”; duplicate sheet IDs are errors.

## Quality assurance

Use a deterministic blind 10–20% sheet sample for a second independent review.
The second reviewer must not see the first response.

Compare only the fields that matter for candidate ranking:

- logo identity: positive, negative, or uncertain;
- applicable roles;
- light/dark usability;
- best candidate per company and role.

Resolve disagreements that would change a positive, a role, theme usability, or
a best choice. Notes and verbose explanations are unnecessary. If one repeated
confusion appears across the QA sample, clarify the shared prompt and rerun the
affected sheets under a new prompt version rather than adding company-specific
rules.

Suggested acceptance checks before freezing labels:

- every generated sheet has exactly one reviewed primary response;
- every original candidate ID expands to exactly one primary label;
- no positive candidate lacks a role or usable background;
- 10–20% has an independent blind review;
- all material QA disagreements are resolved;
- capture, packet seed, prompt, reviewer/task IDs, and timestamps are recorded.

## What is intentionally deferred

Do not optimize the deterministic ranker during this phase. Do not use these
labels to adjust weights, thresholds, discovery rules, or per-company behavior
until the labeling dataset is complete and frozen.

Candidate sheets can judge only assets the scraper retained. A separate later
discovery-recall pass may batch homepage screenshots and ask whether an obvious
company logo is visible but absent from the candidate sheet. That should be a
small screenshot-level audit, not a return to exhaustive per-DOM-element
annotation.

After labels are frozen, a separate plan can define train/validation/evaluation
splits, baseline metrics, deterministic ranker experiments, and holdout policy.

## Definition of done for this phase

The labeling phase is complete when:

- all 500 websites have a frozen capture result or an explicit capture failure;
- every retained visual candidate is present in a numbered sheet mapping;
- every sheet has a validated primary response;
- every candidate ID has one expanded candidate label;
- the blind QA sample and material adjudications are complete;
- the packet, prompt, compact responses, expanded labels, and provenance are
  frozen together;
- no ranker optimization has been mixed into the labeling work.
