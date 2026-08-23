# Numbered AI candidate-labeling audit

Date: 2026-08-23  
Scope: cheap candidate-identity labeling only; no ranker changes

## Outcome

Use `scripts/contact-sheet.mjs` as the base for a small AI-labeling path. Do not
route this task through `scripts/visual-review-packet.mjs` or require the model
to emit canonical visual-benchmark records.

The required addition is deliberately narrow:

1. show each distinct scraped candidate once, with a large entity-local number;
2. freeze the number-to-`candidate_id` mapping beside the sheet;
3. accept one compact JSONL object per entity;
4. validate completeness and expand the numbers back to stable candidate IDs in
   deterministic code.

This labels candidate identity. It does not select a winner, assign roles,
judge rank, or establish exhaustive on-page logo recall.

## Findings

### 1. The lightweight contact sheet is already close, but its labels are not AI-friendly

`scripts/contact-sheet.mjs` already renders several candidates per entity on
light and dark backgrounds and writes a label template. However:

- the visible handle is a long `candidate_id`, not a short number;
- the same candidate can appear once per review role because deduplication is
  keyed by `role + candidate identity`;
- the role selector is prefilled, so downloading without an identity judgment
  still emits a partial label;
- output is one verbose record per candidate/role and mixes identity, role, and
  usability even when the task only needs identity;
- the generated HTML exposes rank scores, reasons, and URLs, which add tokens
  and can bias an identity-only model judgment.

These are presentation and interchange issues. They do not require a ranker
change.

### 2. The exhaustive visual review packet is the wrong abstraction for this pass

`scripts/visual-review-packet.mjs` supports a substantially broader protocol:
entity identity, screenshot and overlay review, DOM visual instances, exact
candidate mappings, candidate roles, five `best_for_role` decisions, two-theme
usability, provenance, defects, missing-role causes, reviewer/pass scoping,
local draft state, attestations, and canonical export.

That machinery is justified for the formal visual benchmark described in
`docs/500-company-visual-logo-benchmark-plan.md`. It is over-engineering for the
narrow question “is numbered candidate N a logo of this company?” Requiring an
AI worker to fill that contract increases prompt size, output failure modes,
and validation work without improving this label.

The following components can therefore be bypassed for the cheap pass:

- visual-instance capture and candidate-to-instance mapping;
- entity and review-attestation labels;
- roles, `best_for_role`, usability, provenance, defects, and missing causes;
- reviewer-scoped label hashes in model output;
- overlap/agreement/adjudication tooling;
- the generic legacy-to-canonical normalizer at the model boundary.

Canonical records may still be produced after validation by deterministic
code, if a downstream consumer needs them.

### 3. The PNG montage is compact but only shows selected winners

`scripts/review-montage.mjs` produces convenient raster pages, but it displays
only the selected icon and wide candidate. Extending the contact sheet is
smaller and safer than turning the winner montage into a candidate-labeling
system.

### 4. Numbering must be a frozen display key, never a replacement identity

Numbers are local to one entity and one generated sheet. They must not enter
stored benchmark labels. A sidecar must be generated in the same pass as the
sheet so later candidate ordering, ranker changes, or regenerated HTML cannot
silently remap a label.

## Smallest useful contract

Generate a sidecar such as `candidate-map.jsonl`, one row per entity:

```json
{"entity_id":"acme","candidates":{"1":"candidate-a1","2":"candidate-b2","3":"candidate-c3"}}
```

Accept AI output as JSONL, also one row per entity:

```json
{"entity_id":"acme","labels":{"1":"correct","2":"wrong","3":"ambiguous"}}
```

This is smaller and easier to validate than one record per candidate. It makes
missing, duplicate, and invented candidate numbers detectable from a single
object.

The three values deliberately reuse the existing identity vocabulary:

- `correct`: a current logo, symbol, wordmark, or lockup of the requested company;
- `wrong`: not the requested company's logo, including partner/customer marks,
  generic UI/decorations, photos, and unrelated brand assets;
- `ambiguous`: the frozen pixels do not support a defensible identity decision.

Do not add role, usability, confidence, notes, reviewer identity, timestamps,
or candidate IDs to model output. Invocation metadata belongs to the job or
the deterministic expansion step. Add fields later only when a real consumer
requires them.

After validation, expand each entry to the existing stable form:

```json
{"entity_id":"acme","candidate_id":"candidate-a1","identity":"correct"}
```

If canonical visual-benchmark rows are required, deterministic code can then
wrap this as a candidate label with `values.identity` and supply provenance.

## Sheet rules

- Number candidates from `1` within each entity; restart at `1` for the next
  entity.
- Deduplicate by `candidate_id` before numbering. A candidate predicted for
  several roles must still have one number and one identity label.
- Freeze ordering in `candidate-map.jsonl`. Do not reconstruct it while reading
  labels.
- Keep company name and domain visible, plus light and dark raster previews.
- Make the number the largest text on each tile and include it in the image alt
  text.
- For the AI variant, omit rank, score, score reasons, preselected role, and
  editable controls. Source and dimensions may remain in a small caption for
  debugging but should not be needed by the prompt.
- Never embed untrusted SVG. Continue using the existing bounded rasterization
  behavior. A missing safe preview must be visibly marked and should normally
  receive `ambiguous`, not an inferred label based on its filename or URL.
- Preserve the current candidate-selection policy for the first version. This
  task should not become a hidden ranker experiment. Candidate-set coverage can
  be evaluated separately.

## Prompt contract

Use the following short prompt with each sheet image or rendered page:

> For each company section, classify every numbered image candidate by visual
> identity only. `correct` means a current logo, symbol, wordmark, or lockup of
> the named company. `wrong` means any other image, including another brand,
> partner/customer logo, UI icon, decoration, photo, or generic graphic. Use
> `ambiguous` only when the visible pixels do not support a defensible decision.
> Do not judge rank, role, file quality, or which candidate is best. Do not infer
> identity from filenames, URLs, scores, or ordering. Return JSONL only, one
> object per company in sheet order, exactly
> `{"entity_id":"...","labels":{"1":"correct|wrong|ambiguous"}}`. Include
> every displayed number exactly once. Do not add keys, prose, or code fences.

For stronger isolation, pass the expected `entity_id` values in text outside
the image. The visible company name/domain remains the identity evidence; the
machine-readable ID is only an output key.

## Validator rules

Reject the whole output before expansion if any rule fails:

1. input is UTF-8 JSONL with one non-empty JSON object per line;
2. each object has exactly `entity_id` and `labels`;
3. `entity_id` occurs exactly once and exists in the sidecar for this sheet;
4. `labels` is a plain object, not an array or scalar;
5. its keys exactly equal the sidecar's candidate-number keys—no missing,
   duplicate, extra, signed, zero, decimal, or padded numbers;
6. every value is exactly `correct`, `wrong`, or `ambiguous`;
7. every sidecar entity has exactly one output row;
8. the sidecar itself has unique entity IDs, unique candidate IDs within an
   entity, contiguous numbers beginning at `1`, and refers only to candidates
   actually rendered in that sheet;
9. expansion uses only the loaded sidecar and never a fresh run or freshly
   sorted candidate list;
10. write expanded labels atomically only after all rows validate.

Do not silently coerce aliases such as `yes`, `logo`, `maybe`, numeric values,
arrays, or markdown-wrapped JSON. A repair retry with the validation error is
cheaper and more auditable than permissive normalization.

## Small implementation plan

1. Add an identity-only/AI mode to `scripts/contact-sheet.mjs` rather than a
   third review UI.
2. In that mode, collapse `reviewCandidates(result)` entries by `candidate_id`,
   assign `display_number`, render the badge, and write `candidate-map.jsonl`.
3. Add a small `validate-numbered-labels.mjs` that implements the strict rules
   above and emits stable candidate-ID labels.
4. Test candidate reuse across roles, entity-local number reset, exact-key
   completeness, unknown entities/numbers, invalid enums, and deterministic
   expansion.
5. Run a 20-entity pilot and measure only output validity, ambiguous rate, and a
   small human spot-check. Do not tune ranker weights or candidate ordering as
   part of this work.

## Decision boundary

Use the numbered path for cheap candidate-identity labeling and triage. Use the
full visual review packet only when the question depends on rendered page
context, exhaustive visible-instance recall, candidate mapping, roles,
usability, missing-root-cause analysis, reviewer agreement, or adjudication.
