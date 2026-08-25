# Candidate-only visual labeling

This is the minimal review path for the frozen 500-company benchmark. It labels
scraped candidates directly and does not inspect or annotate every rendered DOM
instance. It also never imports or changes rank scores.

## Workflow

1. Scrape the benchmark with the existing runner. This retains the current
   extraction and ranking behavior while saving candidate assets:

   ```sh
   npm run benchmark -- --cohort all-500 --output runs/all-500
   ```

2. Deduplicate candidates and render numbered, batched PNG contact sheets:

   ```sh
   node scripts/review/candidate-labeling.mjs prepare --run runs/all-500
   ```

   The packet is written to `runs/all-500/candidate-labeling/`. Candidate bytes
   are deduplicated by content hash, then resolved URL, within each entity. The
   packet contains `manifest.json`, `candidates.jsonl`, `AI-INSTRUCTIONS.txt`,
   and `sheets/*.png`. Candidate numbering is global within this frozen packet.

3. Give the sheets and `AI-INSTRUCTIONS.txt` to a vision-capable reviewer. Its
   response must be JSONL only, with no IDs, scores, prose, or Markdown:

   ```json
   {"candidate_number":17,"roles":["wide"],"flags":["correct","good","best"]}
   ```

   Every number must appear once. Roles are `icon`, `wide`, `favicon`, or
   `other`. Flags contain exactly one identity (`correct`, `wrong`,
   `ambiguous`), exactly one usability (`good`, `conditional`, `unusable`), and
   optional `best`, `theme_specific`, `stale`, `composite`, or
   `preview_missing`. A reviewer must use `ambiguous`, `unusable`, and
   `preview_missing` for a tile that could not be safely rasterized.

4. Validate and merge one or more response shards:

   ```sh
   node scripts/review/candidate-labeling.mjs merge \
     --packet runs/all-500/candidate-labeling \
     --input labels/batch-01.jsonl \
     --input labels/batch-02.jsonl
   ```

   The command rejects unknown or duplicate numbers, extra semantic keys,
   invalid flags, incomplete coverage, and multiple `best` candidates for the
   same entity/role. The output `candidate-labels.jsonl` restores stable
   `entity_id` and `candidate_id` values. `icon`, `wide`, and `favicon` rows use
   the flat label shape consumed by the current benchmark tooling; `other` and
   empty-role labels are retained as candidate ground truth but ignored by the
   current scorer. A visual label is expanded to every candidate ID folded into
   the same content-hash/URL group, so aliases remain joinable.

The current score command treats its `role` field as both the review slot and
the candidate's applicable visual role. Consequently, a selected non-logo
correctly labeled with an empty role (or `other`) will leave that selected score
slot unlabeled. Do not coerce it to `icon` or `wide`: that would turn a false
positive into a role match. Final score integration should either adjudicate
those selected slots separately or extend the scorer to distinguish
`review_role` from applicable `roles`. This workflow intentionally does not
change the scorer or ranker.

Use `--allow-partial` only for an intentional intermediate merge. A partial
file is not adequate for final benchmark scoring. Packet manifests include the
SHA-256 of the frozen `results.jsonl`; regenerate the packet after any new
scrape instead of reusing candidate numbers.
