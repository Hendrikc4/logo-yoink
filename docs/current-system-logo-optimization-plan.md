# Current logo-system optimization plan

Date: 2026-08-23

## Goal

Improve the current system against the frozen 500-company labels without changing the benchmark, adding a new architecture, or tuning on the evaluation split.

The baseline is in [`baseline-current-system-v1.md`](../runs/visual-benchmark-v1-500-v1/merged/label-sheets-v3/baseline-current-system-v1.md).

## What the baseline says

- **Wide ranking is already strong.** When a correct wide candidate exists, the system selects one 93.3% of the time overall. The larger problem is discovery: only 65.5% of current sites have a labeled wide candidate.
- **Icon safety needs attention.** Icon identity precision is 91.9%, with 26 definite wrong-identity selections. Twenty of those 26 come from favicon-family sources (`html-icon`, `apple`, `manifest`, or Google favicon), usually without visible header/nav evidence.
- **Favicon ordering is the clearest low-hanging fruit.** A correct favicon exists for 269 current sites, but the ranker selects one for only 129. There are 140 avoidable misses, mostly because the selected company asset is not visually suitable as a tiny icon.
- **Wide theme choice is a safe reordering opportunity.** Only 109 of 235 correct selected wides work on both light and dark. Seventeen of the remaining companies already have a correct both-theme alternative in the frozen candidate set.
- **There are small ranker-only ceilings before more discovery work:** at most +32 icon, +17 wide, and +140 favicon selections from candidates already in the frozen set.

## Simple sequence

### 0. Make the baseline replayable

Add one small script that reproduces the frozen baseline and writes the same JSON metrics from candidates plus labels. It must reproduce the current 55.47/90 quality subtotal before any experiment begins.

This is not a new framework; it is the command used for every before/after comparison.

### 1. Separate favicon and icon quality

Make one role-specific ranking change:

- For `favicon`, rank actual tiny-image suitability: square shape, clear occupancy/contrast after a 32 px downscale, and agreement with the icon signal. Use HTML/Apple/manifest source only as a weak tie-breaker, not the main rule.
- For `icon`, reduce the weight of favicon-family candidates that lack company-name agreement or visible header/nav/home-link evidence. Do not remove them entirely; they remain useful when no stronger icon exists.

Why first: this targets the largest avoidable error group and should also remove many wrong-brand icon selections.

### 2. Prefer a safer wide theme variant

When several candidates are similarly ranked as wide, prefer one with captured evidence that it works on both light and dark. If no both-theme option exists, keep the current selection.

This is a tie-break/reordering change, not a broader eligibility rule, so identity risk should be low.

### 3. Add a bounded fallback for evidence gaps

Run the existing rendered/header discovery fallback only when a current site has either no candidates at all or no eligible wide candidate. Keep the existing request and candidate budgets.

This addresses both the 37 current zero-candidate sites and the 133 sites with no labeled wide candidate without making every extraction more expensive.

### 4. Only if still needed: recover obvious wide candidates already discovered

Relax wide eligibility only for a narrow case: a wide-shaped, first-party image with a strong logo token and either company-name agreement or visible header/nav/home-link evidence.

This has only a +17 ceiling and risks the system's already-high wide precision, so do it last and do not broadly admit body/customer logos.

## Evaluation loop

For each change:

1. Replay it offline against the frozen candidates.
2. Tune only on development; use validation to decide whether to keep it.
3. Track correct selections and raw wrong-brand counts, plus role precision, end-to-end recall, best-hit rate, and answer rate. Baseline answer counts are icon 333, wide 243, and favicon 336.
4. Reject precision gains that come mainly from returning nothing. Keep answer rate within one percentage point unless a deliberate abstention produces a larger reduction in wrong-brand results.
5. Keep a change only when correct selections improve on both development and validation without a material wrong-brand regression.
6. Run evaluation once after the small bundle is frozen. Because its aggregate baseline is already visible, treat it as final confirmation rather than claiming it is a pristine hidden holdout.

Keep changes isolated so each result is attributable. Stop after steps 1–3 unless their validation results justify trying step 4.

## Success criteria

- Reduce wrong-brand icon/wide domains from 29 without hiding the errors through broad abstention.
- Raise favicon role precision from 38.4% and increase the absolute number of correct favicon selections on both development and validation.
- Recover icon ranker misses without lowering answer rate or role precision.
- Increase both-theme wide selections through reordering before relaxing wide eligibility.
- Improve wide discovery coverage with the bounded fallback while keeping its cost limited to missing-wide sites.

## Explicit non-goals

- No learned model or optimizer.
- No per-company rules or large denylist of one-off hashes.
- No live-site recrawl while tuning rank weights.
- No changes to labels, packet membership, or evaluation assignments.

## Claude Opus 5 review

Claude Opus 5 reviewed the draft independently and returned **approve with changes**. The final plan adopts its material recommendations: avoid source-based favicon overfitting, add a minimal reproducible scorer, track answer rate, prioritize safe wide-theme reordering, include zero-candidate sites in the bounded fallback, and move wide-eligibility relaxation to last.
