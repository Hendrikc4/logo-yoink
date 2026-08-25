# Selection v2 experiment

Date: 2026-08-24

## Question

The frozen visual-benchmark-v1 replay selects each role by stored `role_scores` alone. Miss analysis on the frozen candidate set asked: which selection and eligibility patterns lose role-correct or wrong-brand points that deterministic, label-free rules could recover?

## Method

All experiments ran offline against the frozen artifacts (`runs/visual-benchmark-v1-500-v1/merged`) with the exact replay scorer. Rules were designed and tuned **only** on the development split; validation was touched only to confirm; evaluation was checked once after freezing. Every rule is feature-based (stored geometry, source, placement evidence, reason lines) — no labels, entity names, or hashes are used.

Nine rules survived:

| Rule | Mechanism |
| --- | --- |
| Padded-wordmark demotion | Icon candidates whose wide shape comes from a trimmed content box (`wide shape (content box)` reason) are demoted 40 for the icon role. |
| Favicon-size preference | Declared favicon-family icon candidates gain +8 (edge ≥180 px) or +4 (≥96 px). |
| Rendered-SVG twin | A static serialized inline SVG selected for icon is replaced by a same-geometry rendered browser twin when one exists (serializations can render blank off-page). |
| Relaxed wide shape | Ratio 1.45–1.8 assets ≥120×36 px enter the wide pool when home-linked, header/nav-placed, or authoritative metadata backs them (recomputed score, no generic exclusion). |
| Foreign-named-logo rescue | Same-origin header/nav positive-token candidates excluded by the `foreign named logo` heuristic get one re-scored chance per role. |
| Small favicon fallback | When an entity has zero icon-role candidates, declared favicon-family assets with edge ≥14 px become icon-eligible. |
| Small rendered SVG icons | Home-linked header/nav browser-inline-SVGs of 20–31 px become icon-eligible. |
| Off-host abstention | If every candidate lives on a host unrelated to both the page host and the requested company tokens (and no host looks like a platform CDN), all roles abstain instead of answering from hijacked content. |

Dropped during development: broad positive-token wide admission (admitted partner-carousel logos), webclip/appicon demotion (opened wrong-brand holes), rendered-SVG `<img>` icon admission (indistinguishable from a wrong-brand breaker), footer-region rescue (zero yield).

## Results

Quality subtotal over the full frozen population (development + validation + evaluation, N=385 current-identity entities):

| Metric | Baseline | selection-v2 | Δ |
| --- | ---: | ---: | ---: |
| Quality subtotal | 55.4675 / 90 | **56.8312 / 90** | **+1.3636** |
| Top-1 role correctness (icon+wide) | 276 + 235 | 290 + 239 | +14 icon, +4 wide |
| Wrong-brand icon/wide domains | 29 | 28 | −1 |
| Visual usability | 11.27 | 11.64 | +0.36 |

Per-split development gate: **+2.96** (13 icon fixes, 2 wide fixes, 3 fewer wrong-brand domains, zero correct→wrong flips). Untouched validation confirmed independently: **+1.03** (+2 icon, +2 wide, zero new wrong domains at saturated safety). The single known regression is Bandit Network (validation): its favicon-family fallback admission is labeled wrong — the site exposes no correct asset anywhere in the frozen set, so this is a discovery limit priced into the rule (+7 correct admissions vs −1 wrong admission across splits).

Representative fixed patterns: schema/og social-card squares losing icon slots to the apple-touch family (Pool, Yumlish, Daanaa); padded wordmark canvases read as icons (Thrivewithtype1, Opix); tiny favicons withheld entirely (Raywatt, HEXANIKA, TradeBridge); same-origin `/images/logo*.png` header marks killed by the foreign-named-logo heuristic (Tapin2, Haryon wide); blank-rendered static serializations beating their rendered twins (LinkDR); stale `favicon.svg` variants outranking real icon sets (PharmaCare); an unrelated foreign-host image farm answering every role (Medical Network Solutions → abstention).

## Product changes

`src/rank.mjs` now implements the runtime-mappable subset: padded-wordmark flag and demotion, favicon-size bonus, relaxed wide shape under strong evidence, same-origin placed-header rescue inside `genericAssetReason`, rendered-twin preference, and the small-favicon icon fallback. The remaining rules live in the offline `selection-v2` profile because the frozen artifacts lack the fields they need (rendered small-SVG admission depends on capture-time role marking; off-host abstention is an identity-safety policy kept out of the default product path pending the quarantine policy decision recorded in the experiment log).

Reproduce:

```sh
npm run visual-benchmark:replay -- --baseline-check
npm run visual-benchmark:replay -- --splits development,validation,evaluation --profiles selection-v2
```

## Decision

**Kept** as ranking/eligibility improvements: development gate passed (+2.96 with zero correct→wrong flips and three fewer wrong-brand domains), validation confirmed without tuning, evaluation checked once post-freeze (+1.36 total across all splits). No discovery surfaces were added and no thresholds were tuned against validation or evaluation.
