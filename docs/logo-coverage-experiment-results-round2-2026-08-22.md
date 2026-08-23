# Logo coverage experiments, round 2 — 2026-08-22

The canonical running index of all attempted experiments and their decisions is [`experiment-log.md`](experiment-log.md).

Four isolated OpenCode workers using `openrouter/stealth/ox-alpha` tested the highest-value follow-ups from the coverage plan. Each worker started from the retained role-aware budget and wide-only content-bounds implementation. Product code in the main worktree was not changed by these experiments.

Availability below means that the automated pipeline selected a candidate for a role. It is not, by itself, evidence that the candidate is the correct company logo. Every changed selection was therefore enumerated and visually reviewed before making a retention decision.

## Decision summary

| Experiment | Development result | Holdout result | Decision |
|---|---|---|---|
| Asynchronous browser fallback for missing-wide domains | Wide 44→52; icon/favicon unchanged. Seven of eight new wide selections were correct. | Not run because 7/8 identity precision (87.5%) failed the 90% gate. | **Do not ship or port yet.** Preserve the experiment result; retest only after a narrow identity-conflict gate exists. |
| Off-domain identity quarantine | Removed two confirmed wrong-brand domains and accepted seven legitimate moves/rebrands. | Quarantined one uncorroborated Mocksi→BriefHQ redirect; ground truth remains unknown. Eight corroborated moves were accepted. | **Useful safety experiment, not a coverage win. Keep off by default and do not port the current heuristic yet.** |
| Theme grouping and light/dark usability | Zero real variant pairs, zero corrected theme-slot rescues, zero attributable selection changes. | Not run because the development benefit was zero. | **Drop.** |
| Multi-observation provenance bonus | Same 66/42/67 availability and identical selected URLs in all 300 role slots. | Not run because the development benefit was zero. | **Drop.** |

No round-2 mechanism is promoted into the product path. This is intentional: the one large recall result missed its precision gate, the safety result has unresolved rename behavior, and the other two added data-model complexity without changing outcomes.

## Experiment 1: asynchronous missing-wide browser fallback

The worker built an off-by-default, two-phase harness. A completed static run queues only reachable domains with no wide selection. A shared Chromium process warms content-addressed observation artifacts at concurrency two. A separate zero-network rerank merges only new bytes/URLs and marks browser additions as wide-only, so icon and favicon winners cannot move.

An initial rerank exposed a real isolation bug: byte deduplication could replace an existing static icon with a browser copy of the same bytes and then make it wide-only. The worker fixed this by filtering observations that duplicate known bytes or URLs before merging, and added a regression test. Final suite: 41/41 tests passed.

### Original-100 result

| Metric | Static control | Static plus deferred browser observations |
|---|---:|---:|
| Icon | 68 | 68 |
| Wide | 44 | 52 |
| Favicon | 70 | 70 |
| Foreground p50 / p95 | 630 ms / 3.01 s | Unchanged by construction |
| Foreground requests / bytes | 663 / 34.9 MB | Unchanged |

The cold deferred phase queued 36 domains, made 36 browser invocations, and found 58 validated candidates. Browser page-load p50/p95 was 2.46/4.55 seconds. The phase used about 1,960 browser requests and 38.9 MB of declared transfer, plus 61 validation requests and 2.35 MB. Eight pages reached the existing browser resource cap.

Cache replay worked: the second warm made zero browser invocations, recorded 36 cache hits, and an independent rerank produced a byte-identical `results.jsonl`.

All eight new wide winners were inspected:

- Correct: TradeBridge, Curiominds AI, Utiq, TrialNav, Aryval, Scoped Solutions, and Grapple. Aryval and Scoped Solutions were dark-only assets.
- Wrong identity: `bhr.fyi` selected a RealReports wordmark. The current page identifies itself as RealReports, while the fixture company is Bhr. The static control already selected a RealReports icon for this domain, but the treatment expanded the wrong identity into another role.

The result is a substantial raw gain, but 7/8 = 87.5% is below the predeclared 90% precision gate and violates the stricter zero-new-wrong-brand goal. Holdout was correctly skipped. The harness was not copied into the main worktree because a 250-line experiment stage that cannot be enabled safely would add maintenance without a shippable outcome.

### Smallest sensible retest

Add a narrow browser-candidate conflict check using strong page identity declarations only: for example, a JSON-LD organization name or `og:site_name` that conflicts with both the fixture name and requested-domain tokens. Apply it only to deferred browser promotions, not to all static candidates. Re-run original-100; proceed to holdout only with at least four correct wide gains, at least 95% reviewed precision, zero new wrong-brand domains, and unchanged icon/favicon selections.

## Experiment 2: off-domain identity quarantine

The first strict rule quarantined nine development domains. Six were legitimate moves or rebrands, so the strict rule failed immediately. Ox Alpha then tested a more permissive, off-by-default classifier using current first-party evidence:

- same registrable domain;
- canonical, `og:url`, or JSON-LD references;
- redirect query provenance such as `utm_source=hiwillow`;
- company/domain-coherent shared brand substrings;
- a narrow override for parking, Matomo, phpMyAdmin, or control-panel pages.

The implementation used an approximate embedded suffix list rather than a maintained Public Suffix List dependency. That is acceptable for an isolated experiment, not for production identity enforcement.

### Development and holdout

| Cohort | Control icon/wide/favicon | Treatment icon/wide/favicon | Feature-attributable action |
|---|---:|---:|---|
| Original-100 | 68 / 44 / 70 | 65 / 40 / 67 | Removed RapidVerify→789BET and JUNO Nutrition→Matomo/Kleine assets; other aggregate differences were live-network or CDN drift. |
| Holdout-100 | 78 / 59 / 78 | 76 / 58 / 76 | Quarantined Mocksi→BriefHQ; other aggregate differences were live-network or CDN drift. |

The development quarantines were both confirmed correct by inspecting the control assets. Legitimate moves including Cryptoys→Digitoys, Storyline, Grapple, Fleetcraft, Haze, Mia, and Willow were accepted. Holdout accepted eight more coherent moves.

Mocksi is the unresolved edge: `mocksi.ai` lands on a self-canonical BriefHQ page with no Mocksi reference or token overlap. Quarantine is the safe behavior for avoiding a possible new owner, but it may reject a legitimate rename whose current site removed all historical evidence. External labels, not broader string heuristics, are the appropriate way to resolve that class.

This experiment is a safety improvement rather than a coverage improvement. The tested rule also cannot detect same-domain repurposing such as Bhr/RealReports, and its four-character substring rule could accept unrelated brands. Because it adds roughly 150 lines of identity policy and lacks production-grade registrable-domain parsing, it was not ported. If revisited, use a maintained PSL implementation, store `accepted`/`quarantined`/`unresolved` explicitly, and require reviewer labels for uncorroborated renames.

## Experiment 3: theme variants

The worker tested conservative filename/media grouping plus a small Sharp-based light/dark usability classifier. It did not change ranking. A bug that compared raw and resolved URLs made the same RocketX asset look like a rescue; after fixing identity normalization and recomputing from stored bytes, the corrected result was zero rescues.

Original-100 reproduced 68/44/70 in control. Treatment reported 68/43/70 because Haze Automotive had a transient network failure; there were zero feature-attributable selection changes. Among available winners, the classifier categorized 64 icons and 43 wide assets. It found four multi-member families, all resize-parameter variants of the same asset, and zero actual light/dark pairs.

A bounded browser probe covered 16 deterministic domains, invoked the browser for eight, and added 622 browser requests. Emulating both color schemes produced zero distinct theme bytes and zero variant pairs. No holdout run was justified.

The usability annotation may be useful in a future labeled consumer-specific project, but current classification is heuristic and creates no alternate usable asset. The module, schema fields, review harness, and browser probe were therefore not retained.

## Experiment 4: multi-observation provenance

The first bonus model incorrectly treated manifest, Apple icon, HTML icon, and root favicon declarations as independent corroboration. The worker tightened these into one declaration category before measuring the final treatment.

On original-100, control and treatment both produced 66 icon, 42 wide, and 67 favicon selections. All 300 selected role URLs were identical. Fifty-three domains contained at least one multi-observation candidate; 826 candidates carried observation arrays, nine candidates received a bonus, and eight bonus-bearing candidates were already winners. The treatment changed no actual winner, while `results.jsonl` grew from 2,351,238 to 2,728,823 bytes, about 16%.

The bonus also reinforced pre-existing wrong-identity assets such as Willow/Because, showing that repeated discovery is not independent brand proof. Both the ranking bonus and observation-array expansion were dropped. If provenance is needed for debugging later, emit compact aggregate counters in diagnostics rather than changing ranking or serializing every observation.

## Final retention decision

The already-retained role-aware download budget and wide-only content bounds remain the only enabled coverage changes. Round 2 does not justify another product mechanism yet.

The next useful slice is deliberately one experiment, not four: combine the deferred browser harness with a narrow, strong-evidence identity-conflict veto and repeat the same frozen development gate. Do not add theme schema, provenance bonuses, generic redirect heuristics, or more browser discovery surfaces until that combined test passes reviewed precision and then holdout.
