# Candidate-only visual labeling

This is the minimal review path for the frozen 500-company benchmark. It labels
scraped candidates directly and does not inspect or annotate every rendered DOM
instance. It also never imports or changes rank scores.

## Workflow

1. Scrape or frozen-rerank the benchmark with the existing runner. This retains
   candidate assets and writes `results.jsonl`:

   ```sh
   npm run benchmark -- --cohort all-500 --output runs/all-500
   ```

2. Deduplicate candidates and render numbered, batched PNG contact sheets. The
   sheet builder accepts benchmark `results.jsonl` directly as well as the
   typed `entities.jsonl`/`candidates.jsonl` capture layout:

   ```sh
   npm run visual-benchmark:label-sheets -- build --run runs/all-500
   ```

   The packet is written to `runs/all-500/label-sheets-v3/`. Candidate bytes
   are deduplicated by content hash, then resolved URL, within each entity. The
   packet contains `index.json`, `prompt.md`, `responses-template.jsonl`, and
   `sheets/*.png`. Each source JSONL file is SHA-256-bound in the index, and each
   sheet fingerprint binds its company/candidate mapping and rendered PNG.
   Candidate numbering is local to each frozen sheet.

3. Give the sheets and `prompt.md` to a vision-capable reviewer. Start from the
   response template and return one fingerprint-bound JSON object per sheet:

   ```json
   {"sheet_id":"sheet-0001-abcd1234","packet_fingerprint":"sha256:...","reviewed":true,"logos":[{"n":17,"roles":["wide"],"works_on":["light","dark"]}],"best":{"icon":[],"wide":[17],"favicon":[],"stacked":[]},"uncertain":[]}
   ```

   Omitted numbers become reviewed negatives only when `reviewed` is true.
   Unclear tiles belong in `uncertain`; they must not also appear in `logos`.

4. Validate and merge one or more response shards:

   ```sh
   npm run visual-benchmark:label-sheets -- validate \
     --packet runs/all-500/label-sheets-v3 \
     --labels labels/responses \
     --reviewer reviewer-id \
     --review-pass independent-full-review-v1 \
     --output runs/all-500/candidate-labels.jsonl
   ```

   The command rejects unknown or duplicate numbers, stale fingerprints, extra
   semantic keys, incomplete sheets, and multiple `best` candidates for the
   same entity/role. The output restores stable `entity_id` and `candidate_id`
   values and expands a visual judgment to every candidate ID folded into the
   same content-hash group.

The direct score command treats its `role` field as both the review slot and the
candidate's applicable visual role. Consequently, a selected non-logo or a
correct logo without the selected role would otherwise leave that selected score
slot unlabeled. Do not coerce the canonical candidate label to `icon` or `wide`:
that would turn a role mismatch into a role match. For exhaustive candidate
labels, use the derived selected-slot adapter before scoring:

```sh
node scripts/benchmark/selected-role-scoring-adapter.mjs \
  --run runs/all-500 \
  --labels runs/all-500/candidate-labels.jsonl \
  --output runs/all-500/scoring-labels-selected-slots.jsonl
```

It preserves the canonical candidate label and emits an explicit
`review_role`/`correct` adjudication for every selected icon/wide slot. A role
mismatch remains `correct: false` without changing candidate identity to
`wrong`; canonical icon favicon fallbacks are recognized when no true icon
candidate qualifies. The adapter is a scoring projection, not a replacement
for canonical candidate labels or a ranker change.

Candidate identity alone is also insufficient for the safety component. An
omitted or visually wrong tile can be a non-logo, a related product mark, or a
foreign brand. The v3 sheet importer therefore uses
`unclassified_negative` until a fingerprint-bound safety pass partitions every
negative:

```sh
npm run visual-benchmark:label-safety -- \
  --packet runs/all-500/label-sheets-v3 \
  --labels runs/all-500/candidate-labels.jsonl \
  --safety runs/all-500/safety-responses.jsonl \
  --output runs/all-500/candidate-labels-safety-complete.jsonl \
  --reviewer reviewer-id \
  --review-pass exhaustive-negative-safety-v1
```

Each sheet response assigns every reviewed negative exactly once to
`wrong_brand`, `related_brand`, `not_logo`, or `unjudgeable`. The command rejects
unknown candidate numbers, duplicate assignments, incomplete sheets, stale
packet fingerprints, and overwrites without `--overwrite`. A selected
`unclassified_negative` intentionally makes the benchmark score incomplete.

A partial file is not adequate for final benchmark scoring. Packet manifests
include the SHA-256 of the frozen `results.jsonl` (or each typed capture input),
and packet validation rejects changed source bytes. Regenerate the packet after
any new scrape or rerank instead of reusing candidate numbers.
