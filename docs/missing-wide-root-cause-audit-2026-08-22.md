# Missing-wide root-cause audit — 2026-08-22

## Decision

No new discovery surface should be enabled. The already-retained asynchronous browser path recovered 10 correct wide logos from 75 audited misses, with two ambiguous current identities and no wrong-brand selection. A narrowly constrained CSS-mask treatment added one correct, light-only Planhat wordmark: 1.33 defensible correct wins per 100 audited misses, below the predeclared 2.0-per-100 prevalence gate. The mask implementation was therefore removed. Existing precision filters were unchanged throughout.

## Frozen cohort and method

The control is the precision-ranked remaining-300 run at `/Users/hendrik/Documents/logo-yoink/runs/review-final-remaining-300/results.jsonl`, produced by current `main` (`1dc320b`). It contains 300 records: 257 reachable companies, 144 accepted wide logos, and 113 reachable records without an accepted wide logo.

[`prepare-missing-wide-audit.mjs`](../scripts/prepare-missing-wide-audit.mjs) ranks those 113 eligible records by SHA-256 of the fixed seed `missing-wide-root-cause-audit-v1` and entity ID, then takes the first 75. Input order does not affect the sample. The frozen sample and observations are in the ignored local run directory `runs/missing-wide-audit-2026-08-22/`.

Every company page was captured in a real browser and visually inspected. Each miss received exactly one primary cause: the earliest cause that explains why the precision-ranked static control has no defensible wide winner. Every treatment-changed asset was also rendered on light and dark panels. “Ambiguous” means the current page clearly presents a coherent brand but the fixture-to-current-identity relationship cannot be established from first-party evidence; ambiguous is counted as non-correct in strict precision.

Reproduction commands:

```sh
node scripts/prepare-missing-wide-audit.mjs \
  /Users/hendrik/Documents/logo-yoink/runs/review-final-remaining-300 \
  runs/missing-wide-audit-2026-08-22/control 75
node scripts/warm-browser-observations.mjs \
  runs/missing-wide-audit-2026-08-22/control \
  runs/missing-wide-audit-2026-08-22/browser-observations 2 12000
node scripts/replay-browser-observations.mjs \
  runs/missing-wide-audit-2026-08-22/control \
  runs/missing-wide-audit-2026-08-22/browser-observations \
  runs/missing-wide-audit-2026-08-22/browser-treatment
```

Network totals are cold, live-web observations and include browser discovery plus candidate validation. They are useful cost measurements, not byte-stable fixtures; treatment deltas can include CDN and page drift.

## Root causes

| Primary root cause | Count | Share | Reproducible definition |
|---|---:|---:|---|
| Icon-only or stacked brand | 18 | 24.0% | Current page exposes only a symbol, a near-square/stacked lockup, or a symbol plus live HTML text—not a separate wide graphic asset. |
| Text-only or absent graphic wordmark | 14 | 18.7% | Brand is rendered as ordinary text, or no brand graphic is exposed. |
| JS/lazy browser DOM | 12 | 16.0% | A valid wide asset appears after browser hydration and is absent from the frozen static selection. |
| Rank/precision-filter rejection | 11 | 14.7% | A plausible first-party asset exists, but current evidence, shape, or safety rules correctly decline to promote it. |
| Unsafe or changed identity | 10 | 13.3% | Domain is parked, repurposed, compromised-looking, or presents an unresolved different current identity. |
| Blocked or incomplete render | 6 | 8.0% | Blank, loading, access-gated, or interstitial state prevents a defensible observation. |
| CSS mask/background asset | 3 | 4.0% | Brand art is supplied through CSS rather than an ordinary image/SVG node. One occurrence was transient. |
| Logo embedded in content image | 1 | 1.3% | Brand art exists only inside a larger hero/content composition. |
| **Total** | **75** | **100%** | |

The mutually exclusive classifications were:

- **Icon-only or stacked brand (18):** Cavero Quantum, Zubachee, NOA, Blueprint, EliotNest, GRAMFS, Maingen, Sensible, General Instinct, Lendao, Lookiar, Plask, BlueFoot Inc., Hapteon, Enneo, Candice AI, CWALLET, and finQbit.
- **Text-only or absent graphic wordmark (14):** CyberSec, SimulPlus Films, Coordle, Blue Spruce AI, Molecule Systems, Trustiu, DevBots, Bineric AI, Centrality Labs, Rinstra Technologies, Novos Power, Bandit Network, Annotation AI, and MyySports.
- **JS/lazy browser DOM (12):** Sondera, Quansys, Lydian, Edificex, DNA Chat, Edutechs, Optilyx, Whitebox Editor, Vetra AI, OpenSphere, Amukha, and Remitation.
- **Rank/precision-filter rejection (11):** Advl, LexLynk, Robomotion, MattoBoard, Arcanite, Fratellidesideri, ai|coustics, Vycto, MY HEALTHY®, Strata, and Mikrofleks.
- **Unsafe or changed identity (10):** Drip Labs, Medical Network Solutions, Sadie, SenpAI.GG, Babel, Obseva, Fluxiontherapeutics, BanterAI, Atrium Exchange, and Kellify Group.
- **Blocked or incomplete render (6):** Orb Labs, Endstack, Raywatt, Coyax, ISD, and Intelligent Health.tech.
- **CSS mask/background asset (3):** Nth Cycle, Daanaa, and Planhat.
- **Logo embedded in content image (1):** Genopets.

Representative evidence:

- Browser hydration exposed Quansys `/logo.png`, Edificex `just_text…svg`, DNA Chat `/dnachathorizontal.png`, Optilyx `optilyx-logo-mono…png`, and Amukha `/assets/images/Amukha-logo-new.svg`.
- Robomotion's correct inline SVG and Arcanite's top-navigation asset were discovered but rejected under the retained precision rerank. MY HEALTHY® is a padded near-square canvas containing a wordmark; Strata presents a 120×40 navigation image without enough trusted semantics. These are evidence/ranking misses, not undiscovered URLs.
- Drip Labs now presents Colette; Obseva redirected to a football/gambling identity; BanterAI presented casino content; Fluxiontherapeutics, Atrium Exchange, and Kellify Group were parked. Selecting their current graphics for the fixture brands would be unsafe.
- Planhat reproducibly uses a home-linked 128×68 CSS mask. Daanaa's faint footer background has opacity 0.1 and lacks the trusted header/home-link evidence required for promotion. Nth Cycle showed a CSS mask during audit capture but it could not be reproduced in the treatment run.
- Genopets' brand treatment is embedded in a larger hero illustration, so extracting it would also extract unrelated content.

## Existing asynchronous browser path

The precision-gated browser mechanism already retained on current `main` was replayed without modification against the 75-record miss sample.

| Metric | Frozen control | Browser treatment |
|---|---:|---:|
| Accepted wide | 0 | 12 |
| Correct / ambiguous / wrong changed selections | — | 10 / 2 / 0 |
| Strict incremental precision | — | 83.33% (10/12) |
| Wrong-brand domains | 0 | 0 |
| Icon / favicon movement | — | 0 / 0 |
| Browser invocations | — | 75 |
| Requests, including validation | — | 4,859 |
| Bytes, including validation | — | 145,543,404 (145.54 MB) |
| Browser deferred latency p50 / p95 | — | 2.429 / 6.798 s |
| Cold wall time | — | 117.931 s |

The ten correct additions were Sondera, Quansys, Lydian, Edificex, DNA Chat, Edutechs, Optilyx, OpenSphere, Amukha, and Remitation. Whitebox Editor now presents Gorest, and Vetra AI now presents PawBeat VET; both are coherent current-page logos but unresolved fixture identity transitions, so both are ambiguous and receive no correctness credit. The existing identity-conflict veto withheld one additional conflicting candidate.

All twelve assets were inspected on light and dark. Lydian is usable on both. The other nine correct assets are conservatively conditional because each loses contrast on one background or is substantially weaker there. Using the benchmark's current scoring, the ten correct additions and 5.5 usability-equivalent additions contribute +0.84 points: 71.97→72.81 against the canonical baseline, or verified current `main` 72.94→73.78 when composed with the prior retained browser gains. Full-cohort wide availability would be 248→260 and strict selected icon/wide precision would be 587/597 (98.32%)→597/609 (98.03%), with zero wrong-brand domains.

This result validates the prevalence of the already-retained off-path browser queue; it does not justify a broader discovery change. The two current-identity ambiguities also reinforce keeping browser candidates deferred and reviewable.

## Targeted CSS-mask ablation

The only new surface with multiple observed cases was CSS-delivered art. The isolated treatment admitted only visible, wide (ratio 1.8–12), data-SVG masks inside a header/navigation/banner or a home-linked anchor. It marked candidates browser-wide-only and left all ranking and precision exclusions intact.

Compared with the browser treatment, the mask treatment produced one new role-availability gain:

| Changed company | Result | Light/dark review | Verdict |
|---|---|---|---|
| Planhat | Home-linked CSS-mask wordmark | Correct on light; invisible on dark | Correct, conditional |
| OpenSphere | Same already-correct wordmark, byte serialization changed during live capture | Correct on light; black portion disappears on dark | No availability or verdict change |

Nth Cycle's audit-time mask did not reproduce. Daanaa remained correctly withheld because its low-opacity footer/background placement did not satisfy the narrow evidence gate.

| Metric | Existing browser | Browser + mask |
|---|---:|---:|
| Accepted wide | 12 | 13 |
| Feature-attributable correct / ambiguous / wrong | — | +1 / 0 / 0 |
| Correct wins per 100 audited misses | — | 1.33 |
| Strict incremental precision | — | 100% (1/1) |
| Wrong-brand domains | 0 | 0 |
| Icon / favicon movement | — | 0 / 0 |
| Requests, including validation | 4,859 | 4,970 |
| Bytes, including validation | 145,543,404 | 153,919,037 |
| Browser deferred latency p50 / p95 | 2.429 / 6.798 s | 2.099 / 4.687 s |
| Cold wall time | 117.931 s | 100.185 s |

The Planhat data-SVG itself requires no fetch. The observed +111 requests, +8,375,633 bytes, and lower latency are live-page/CDN drift between cold runs rather than a defensible feature cost or speedup. The attributable coverage gain is one wide selection; its benchmark delta is +0.08 because it is correct but conditional.

The treatment fails the required prevalence gate: 1/75 is 1.33 correct wins per 100, below 2.0. No holdout was run, and all mask code was removed. The result replaces the earlier “deferred” mask hypothesis with a measured **dropped — prevalence-limited** decision for this cohort. Reconsider only after a new frozen miss audit contains at least two independently reproducible, precision-eligible CSS-mask wins per 100.

## Recommendation

Keep the current precision filters and retained asynchronous browser mechanism unchanged. The residual population is dominated by sites that do not expose a separate wide asset at all (32/75 icon/stacked plus text/absent), while another 16/75 are unsafe, blocked, or incomplete. Broadening discovery cannot safely solve those groups.

The next precision-preserving investigation should start from the 11 rank/filter rejections, label the exact rejecting rule and candidate evidence, and seek one narrow positive-evidence rule or veto. It must not lower existing thresholds. Any implementation still needs at least two defensible correct wins per 100 audited misses, zero new wrong-brand selections, visual review of every changed asset on light/dark, and a frozen holdout only after the development gate passes.
