# Reviewed 500-company labels

`review-500-before-precision-2026-08-22.jsonl` contains the complete human review of all 602 icon and wide-logo selections from the prior rerank of the frozen 500-company fixture. It includes the false positives that drove the precision work.

`review-500-final-2026-08-22.jsonl` contains the transferred labels for unchanged selections plus explicit visual reviews of every replacement retained by the final rerank.

Each record is keyed by `entity_id`, `candidate_id`, and `role`. `identity` is `correct`, `wrong`, or `ambiguous`; `usability` is `good`, `conditional`, `unusable`, or a light/dark theme-state object. The matching scored run is generated at `runs/review-final-all-500` and is intentionally excluded from version control because it contains downloaded assets.

The prior set has 602 selected-role records: 568 correct, 23 wrong, and 11 ambiguous. The final set has 586 records: 576 correct, 0 wrong, and 10 ambiguous.
