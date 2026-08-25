# Reviewed 500-company labels

`review-500-before-precision-2026-08-22.jsonl` contains the complete human review of all 602 icon and wide-logo selections from the prior rerank of the frozen 500-company fixture. It includes the false positives that drove the precision work.

`review-500-final-2026-08-22.jsonl` contains the transferred labels for unchanged selections plus explicit visual reviews of every replacement retained by the final rerank.

Each record is keyed by `entity_id`, `candidate_id`, and `role`. `identity` is `correct`, `wrong`, or `ambiguous`; `usability` is `good`, `conditional`, `unusable`, or a light/dark theme-state object. The matching scored run is generated at `runs/review-final-all-500` and is intentionally excluded from version control because it contains downloaded assets.

The prior set has 602 selected-role records: 568 correct, 23 wrong, and 11 ambiguous. The final set has 586 records: 576 correct, 0 wrong, and 10 ambiguous.

`identity-quarantine-challenge-2026-08-23.json` is the frozen adversarial identity set. It is constructed from all non-correct records above plus every off-domain redirect in the fresh current-main all-500 run. It stores bounded structured identity observations and run selections, not raw HTML or asset bytes. Evaluate it offline with:

```sh
node scripts/identity-quarantine-challenge.mjs evaluate \
  labels/identity-quarantine-challenge-2026-08-23.json
```

`major-brands-300-candidate-labels-v3-2026-08-24.jsonl` is the exhaustive
candidate-only visual review for the separate major-brands cohort: 2,732 labels
covering all candidates from 227 successful captures. It contains 875 positive
and 1,857 negative judgments with no uncertain rows. Its SHA-256 is
`e9e58cc9866af47184b3d8d17748ac6f01dd8d6b37a8e04ca260735a3b409429`.
The corresponding raw packet remains under the gitignored
`runs/2026-08-24-major-brands-300-stage-2/` directory.

`major-brands-300-candidate-labels-v4-2026-08-25.jsonl` supersedes v3 for
quality and ranking claims. Three independent visual-review batches cover all
2,732 frozen candidates, an exhaustive second pass assigns a concrete safety
class to every negative, and provenance-checked cross-review adjudications
resolve selected-slot and changed-selection disagreements. It contains 1,019
correct, 1,682 wrong, and 31 ambiguous identity judgments. Its SHA-256 is
`c626fa829de7268911e949f359a74f71e6494c0c5b36cdacfbd271884c8bf4b2`.
The v3 file remains immutable historical evidence and must not be rewritten.
