# Workstream 1: deferred AI identity verifier

Date: 2026-08-24

Prompt version: `identity-veto-v1`

Model bundle: `gpt-4o-mini-2024-07-18`, temperature 0

Decision: **SUPERSEDED — scaffold kept, subsequent Luna/Sol calibration failed**

This report records the initial API-oriented scaffold and its original blocker.
Calibration later proceeded through Codex subscription tasks after page context was
frozen. Luna v2–v4 and a stronger Sol escalation still failed the acceptance gate;
see the [cycle summary](identity-verifier-cycle-summary-2026-08-25.md). The verifier
therefore remains disconnected from production selection paths.

## Outcome

The smallest deferred identity-verifier module and CLI are implemented, but no model calibration result is claimed. No `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` was available, and the complete required calibration input cannot be reconstructed without qualification: two of the 2,277 adjudicated candidates have no frozen image bytes, the candidate-label packet stores no declared page-identity fields, and the 51-entity challenge artifact's referenced current-main source run is absent. Substituting metadata-only judgments would violate the experiment directive.

Consequently, the acceptance gate was not evaluated, the verifier is not approved for live use, and no product default or synchronous extraction/API path changed. This result is classified as data-limited rather than precision-limited because no model verdicts exist from which precision can be measured.

## Frozen inventory

The inventory was read from the primary repository's ignored frozen runs without copying, refreshing, or mutating any artifact. Frozen labels, packet membership, and the 300/100/100 development/validation/evaluation split remain unchanged.

| Artifact | Frozen records | Image-byte coverage | Context coverage | Limitation |
|---|---:|---:|---|---|
| Adjudicated candidate packet | 2,277 labels over 348 entities: 1,453 correct, 817 wrong, 7 ambiguous | 2,275/2,277 | company, domain, source URL, and placement 2,277/2,277; declared page identity 0/2,277 | You Just Run and GAIT oversized ambiguous candidates intentionally have no stored asset bytes. |
| Before-precision 500 labels | 602: 568 correct, 23 wrong, 11 ambiguous | 602/602 | company/domain/source/placement present; declared page identity absent from the frozen result records | All 23 historical wrong selections have bytes. |
| Final 500 labels | 586: 576 correct, 10 ambiguous | 586/586 | company/domain/source/placement present; declared page identity absent from the frozen result records | No definite-wrong final label by construction. |
| Identity challenge | 51 entities; 50 successful identity observations; 99 historical/final label references | 99/99 referenced label images map to bytes | declared identity signals exist for 50/51 | `runs/identity-quarantine-current-main-all-500` is absent, so fresh current-main candidate membership/bytes cannot be replayed as frozen. JUNO's observation is the documented failure. |

Provider inventory inspected names/presence only. A Jina key exists but is not a suitable vision-verdict provider. OpenAI and Anthropic API keys are absent. Installed interactive CLIs and a signed-in cloud account were not treated as application credentials and no credentials were extracted or printed.

## Implementation

`src/identity-verifier.mjs` is an isolated module that is not imported by the extractor, public API, server, ranker, or discovery code. The experiment CLI accepts a single request or JSONL calibration cases. Each cache miss:

1. verifies the optional declared content hash against the actual bytes;
2. renders one deterministic 1,024×512 PNG with the candidate centered on white and `#15191f` panels, including embedded-PNG and uncompressed 32-bit DIB ICO frames;
3. sends one image-bearing Responses API request with the versioned prompt, temperature 0, strict JSON Schema, no tools, and no storage;
4. accepts only a valid `accept | reject | ambiguous` plus a judgment-compatible machine reason, with at most one retry;
5. atomically caches canonical JSON by SHA-256 of `(content hash, company, lower-cased domain, prompt version)`.

`ambiguous` and `reject` both return `shouldWithhold() === true`. The module has no mechanism to add, rank, re-rank, or promote candidates. Replay-only mode fails closed on a cache miss. On a hit it reads the stored bytes directly and performs no provider call.

The fixed cheap model was selected because official OpenAI documentation states that GPT-4o mini accepts image input, supports Structured Outputs, and is available on the Responses API. The recorded price formula uses the published GPT-4o mini rates of $0.15/M input, $0.075/M cached input, and $0.60/M output tokens. Sources: [GPT-4o mini model](https://developers.openai.com/api/docs/models/gpt-4o-mini), [Responses API create reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).

## Calibration result and costs

No live model call was made and no cache artifact was fabricated.

| Labeled identity | Accept | Reject | Ambiguous |
|---|---:|---:|---:|
| Correct | N/A | N/A | N/A |
| Wrong | N/A | N/A | N/A |
| Ambiguous | N/A | N/A | N/A |

- Accept precision: not measurable; the required ≥98% gate is **not passed**.
- Harmful-control accepts: not measurable; the required zero-accept gate is **not passed**.
- Judgments: 0.
- Input/output tokens: 0/0.
- Actual dollars spent: $0.00.
- Per-judgment tokens/dollars/latency: N/A because no judgment was made.
- Ambiguous escalation: not implemented; no frozen calibration exists to justify it.

## Required individual controls

The following table reports byte/render readiness only. `Not evaluated` is not a model judgment.

| Control | Frozen visual evidence | Model result | Gate status |
|---|---|---|---|
| RapidVerify → 789BET | icon and wide bytes present; the ICO regression now renders successfully | Not evaluated | Unproven |
| Haryon → LEON Casino | tracked crop SHA-256 `2e8ebc8e…aa41` present and renders | Not evaluated | Unproven |
| Bhr → RealReports | historical icon plus frozen RealReports wordmark bytes present | Not evaluated | Unproven |
| JUNO Nutrition → Matomo | Matomo application icon and wordmark bytes present | Not evaluated | Unproven |
| WASPITO partner | Activa candidate SHA-256 `ace7fe57…8215` present and renders | Not evaluated | Unproven |
| Medical Network Solutions photo | candidate SHA-256 `46c9de27…f6aa` present and renders | Not evaluated | Unproven |
| Remaining 17 historical wrong selections | all bytes present through the before-precision run | Not evaluated | Unproven |

Known-hard legitimate cases also remain unjudged:

| Legitimate case | Frozen evidence | Model result | Requirement status |
|---|---|---|---|
| Willow → Because | one correct labeled image plus challenge identity declarations | Not evaluated | No systematic-reject claim possible |
| Klipy / `useklipy.com` | two correct labeled images plus Klipy/Klipy.ai declarations | Not evaluated | No systematic-reject claim possible |
| Raiqon AI | two correct labeled images plus Raiqon AI declarations | Not evaluated | No systematic-reject claim possible |
| Ahgpay / AHG Pay | five correct owned-packet candidates, including the white logo | Not evaluated | No systematic-reject claim possible |
| Cryptoys → Digitoys | two correct final labeled images plus Digitoys declarations | Not evaluated | No systematic-reject claim possible |

## Verification performed

- Focused unit tests cover deterministic light/dark rendering, the harmful ICO container, exact cache-key inputs, strict judgment/reason validation, veto semantics, temperature-zero single-image request shape, exactly one retry, calibration accounting, and replay-only behavior.
- A cold fake-provider result followed by replay proves one provider call on the miss, zero calls on replay, and byte equality among the original returned artifact, the cache file, and replay output.
- The six named harmful visual groups were mechanically rendered from frozen bytes; this was only a renderer check and was not counted as calibration evidence.

## Stop decision

Stop at Workstream 1. Do not connect the verifier to deferred enrichment, do not run Workstream 2, and do not change product defaults. A future rerun needs an approved API credential and a frozen, explicit policy for the two missing candidate images and absent page-identity fields. Any prompt or model-bundle change must use a new prompt version and empty calibration cache.
