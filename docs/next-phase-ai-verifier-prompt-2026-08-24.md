# Next phase: break the identity-precision bottleneck with an async AI verifier

Date: 2026-08-24
Audience: Logo Yoink research/engineering agents
Status: completed through Workstream 1; stopped at the required no-go gate

Outcome: the deferred verifier scaffold, renderer, cache, replay path, and versioned
prompts were built. Luna v1–v4 and a stronger Sol escalation were calibrated on the
frozen development controls, but none simultaneously met identity safety and
known-legitimate recall. Per this directive, Workstreams 2–4 were not run and no AI
verdict was enabled in production. See the
[cycle summary](identity-verifier-cycle-summary-2026-08-25.md).

## Why this direction

Read `docs/experiment-log.md` before starting. The pattern across the last two rounds is
unambiguous:

- **Recall mechanisms work.** The deferred browser path found 22 correct wides on the
  remaining-300, 10 more in the 75-miss audit, rendered crops found real wordmarks, and
  foreign-name relief recovered Tapin2. Discovery is not the blocker.
- **Every one of those experiments died on the same gate: identity precision.**
  Remaining-300 warming: 81.8% (needed 95%). Miss-audit replay: 83.3%. Rendered crops:
  50% (LEON Casino on Haryon). Foreign-name relief: 50% (same asset). Each failure was
  1–2 wrong-brand admissions poisoning 10–20 correct gains.
- **Deterministic identity rules are exhausted.** The structured-identity challenge set
  (`labels/identity-quarantine-challenge-2026-08-23.json`) tested every reasonable
  string/metadata rule; all had false quarantines and zero current safety gain. The
  experiment log itself concludes: "add a veto, not more discovery." That veto cannot be
  written as a string heuristic. It is a visual/semantic judgment: *"is this image
  plausibly the logo of company X, whose site is domain Y?"* — which is exactly what a
  vision model is good at and what our human reviewers already do by hand for every
  changed selection.

We are sitting on roughly **+30–40 correct wide selections that were already found and
then discarded** because we lacked a trustworthy automated veto. Building that veto once
unblocks all of them, plus every future recall experiment.

This does **not** change the product promise. Extraction stays deterministic and
AI-free on the synchronous path. The verifier runs only on the asynchronous/deferred
enrichment path (the same architecture as browser warming), and its verdicts are
cached, content-addressed artifacts — the same way AI-built labels already shaped the
ranker.

## Workstream 1 (core): the identity verifier

Build one script/module: given a candidate asset plus context, return
`accept | reject | ambiguous` with a short machine-readable reason.

Inputs per judgment:
- the candidate image bytes (rendered to PNG on light and dark panels, as the montage
  tooling already does);
- the requested company name and fixture domain;
- the source URL, placement evidence (header/nav/home-link/alt text), and the current
  page's declared identity fields we already collect (JSON-LD name, `og:site_name`,
  title, canonical).

Implementation notes — keep it simple:
- One vision-capable model call per candidate (use a small/cheap model first, e.g.
  Haiku-class; escalate to a stronger model only on `ambiguous` if calibration shows it
  pays). Temperature 0, structured JSON output, one retry.
- Cache verdicts keyed by (content hash, company, domain, prompt version). Replay must
  be zero-network and byte-identical, matching the existing observation-cache
  discipline.
- The verifier is a **veto only**. It never promotes, re-ranks, or adds candidates. An
  `accept` means "does not conflict with the requested identity"; the deterministic
  ranker still decides everything else. `ambiguous` = withhold (count as non-correct).

**Calibration is free — do it before any live use.** We already own ground truth:
2,277 adjudicated candidate labels, the before/after 500-label sets, and the 51-entity
challenge set containing all 23 historical wrong selections and the Bhr→RealReports
same-domain control. Run the verifier over these frozen artifacts and report a
confusion matrix. Acceptance gate for the verifier itself:

- ≥ 98% precision on `accept` against labeled-correct candidates (false rejects are
  tolerable; false accepts are not);
- **zero accepts** on the 23 historical wrong-brand selections and the challenge-set
  harmful controls (789BET, LEON Casino, RealReports, Matomo, WASPITO partner logo,
  Medical Network Solutions photo, etc.);
- reasonable behavior on the known-hard legitimate cases: Willow→Because,
  Klipy/`useklipy.com`, Raiqon AI, Ahgpay/AHG Pay, Digitoys — these must not be
  systematically rejected (some `ambiguous` is acceptable; document each).

If the verifier cannot pass this on frozen data, stop and report — do not proceed to
Workstream 2 with a leaky veto.

Record cost per judgment (tokens, dollars, latency) in the report. Expect on the order
of one to a few judgments per enriched domain — this only runs on *new/changed*
deferred candidates, not on every extraction.

## Workstream 2: re-run the shelved precision-limited experiments behind the veto

In order, each as an isolated experiment with the existing gates
(≥95% strict incremental precision, zero new wrong-brand domains, zero icon/favicon
movement, blind visual review of every changed selection):

1. **Remaining-300 browser warming + verifier veto.** The frozen artifacts exist
   (`runs/`); this is an offline replay plus ~22 verifier judgments. Expected: the 18
   correct additions survive, WASPITO and Medical Network Solutions are vetoed, the two
   ambiguous (Vetra AI/PawBeat, SPIRL/Defakto) come back `ambiguous`. If that holds,
   the gate passes and this ships as the default deferred-enrichment behavior.
2. **75-miss-audit browser replay + veto** (same shape: 10 correct, 2 ambiguous should
   partition cleanly).
3. **Foreign-name relief / wide-rescue rules from the 2026-08-24 experiment**, re-run
   with the verifier as the final check instead of the accessibility-name grammar
   alone. Tapin2 should survive; Haryon/LEON must be vetoed. This may also let you
   safely relax the `foreign named logo` heuristic that the rescue ledger shows is
   suppressing 5 of 17 recoverable wides.
4. **Off-host abstention / parked-and-rebranded domains**: replace silent weirdness
   with an explicit per-domain identity status (`current`, `redirected-corroborated`,
   `rebranded`, `parked`, `hijacked`, `unresolved`) decided with verifier input. This
   converts the 13% "unsafe/changed identity" miss class from a scoring loss into a
   correct, explainable abstention, and it resolves the pure-rename policy question the
   quarantine experiments kept deferring.

## Workstream 3 (after 1–2 land): wordmarks for sites that have no wide asset

The miss audit shows 43% of remaining wide misses are sites exposing **no separate wide
graphic at all** (24% icon-only/stacked, 19% brand-as-HTML-text). No discovery surface
fixes these. Two bounded moves:

- **Rendered header-brand capture, verifier-gated.** Resurrect the rendered-crop
  mechanism from `rendered-wide-experiment-3` exactly as built (it was mechanically
  sound; deterministic trim/reject logic already exists) and add the verifier as the
  final gate. Its 50% precision failure was precisely one identity error the verifier
  is calibrated to catch. Keep the output in a clearly separate `rendered_wide` tier,
  background-annotated, never displacing a portable asset.
- **Honest icon-only answers.** When the verifier confirms the brand is icon-only or
  text-only, return that as a structured fact (`wideStatus: "icon-only-brand"`) instead
  of an empty slot. Check whether the benchmark scoring can credit a correct
  "no wide exists" determination; if it can't, propose the small scoring addition in a
  separate doc rather than silently changing the score.

Do **not** synthesize logos (no icon + typeset-name composition). That crosses the
"no invented logos" product line.

## Explicit non-goals

- No AI calls on the synchronous extraction path; the public API stays deterministic.
- No new deterministic identity string heuristics — that direction is measured dead.
- No new discovery surfaces (CSS masks, BIMI, registries, press pages, etc.) — all
  measured zero-yield or prevalence-limited on this cohort; the log's retest triggers
  stand.
- No model training/fine-tuning, no embedding pipelines, no per-company allowlists.
- No touching frozen labels, packet membership, or the evaluation split; evaluation is
  replayed once per shipped bundle, as before.

## Process requirements

Keep the discipline that made the existing log trustworthy:

- One hypothesis per experiment; frozen inputs; deterministic replay; blind light/dark
  review of every changed selection; costs (requests, bytes, judgments, dollars,
  latency) recorded; one row appended to `docs/experiment-log.md` with a detail doc.
- Verifier prompt text is versioned; any prompt change invalidates the verdict cache
  and re-runs calibration (Workstream 1 gates) before reuse.
- Report negative results with the standard taxonomy (precision-limited, cost-limited,
  prevalence-limited, policy-limited, zero-yield).

## Success criteria for the cycle

Against the canonical frozen 500 (385 current-identity entities):

- End-to-end wide coverage from 235/385 (61.0%) to **≥ 265/385 (~69%)**, counting the
  separate rendered tier distinctly and honestly.
- Wrong-brand icon/wide domains: **stay at zero** on the composed default path.
- Strict selected icon+wide precision **≥ 98%**.
- Icon and favicon selections: zero unreviewed movement.
- Verifier calibration report checked in, with per-judgment cost, before any live gate
  decision uses it.

Stretch, only if the above lands cleanly: re-examine the 26 wrong-identity icon
selections and the 53 remaining favicon misses with the same verifier-as-veto pattern.
