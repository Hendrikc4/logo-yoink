# GPT-5.6 Luna identity-verifier feasibility gate

Date: 2026-08-24
Prompt version: `identity-veto-v1`
Decision: **STOP/NO-GO — precision-limited under context limitation**

## Summary

The Logo Yoink identity-verifier feasibility gate was completed as a negative
experiment. The reviewer was configured as `gpt-5.6-luna` through the Codex
subscription. That is the configured reviewer model; exact runtime model
provenance is not independently embedded in the artifact. The gate reviewed 26
cases and the hard-legitimate packet reviewed 12 cases, for 38 judgments total.

The veto remained leaky: exactly one genuine wrong/harmful accept was observed,
Userpilot. The Bhr expected-correct accept was a passed paired same-domain
control, not a harmful accept. Gate-only accept precision was 1/2 = 50.0%, and
combined reviewed accept precision was 6/7 = 85.714%. Both are below the 98%
threshold, and the zero-harmful-accept requirement also failed. The balanced
pilot and full manifest must not be run under this failed configuration. There
is no Workstream 2.

## Evidence and scoring

### Gate packet

The harmful gate distribution was:

| Expected/output accounting | Accept | Reject | Ambiguous | Total |
|---|---:|---:|---:|---:|
| Harmful gate cases | 2 | 20 | 4 | 26 |

The two accepts were one genuine harmful/wrong accept, Userpilot, and one
expected-correct Bhr accept. The Bhr case is the passed paired same-domain
control and must not be counted as harmful. Excluding expected-ambiguous cases
from the accept-precision denominator gives 1 correct accept / 2 accepts =
50.0%.

### Hard-legitimate packet

| Packet | Accept | Reject | Ambiguous | Total |
|---|---:|---:|---:|---:|
| Hard-legitimate | 5 | 3 | 4 | 12 |

Across both reviewed packets, there were 6 correct accepts and 1 wrong accept:
6/7 = 85.714% combined reviewed accept precision.

The requested identity controls were:

| Identity/control | Accept | Reject | Ambiguous |
|---|---:|---:|---:|
| Willow → Because | 0 | 1 | 0 |
| Klipy | 1 | 0 | 1 |
| Raiqon | 1 | 0 | 2 |
| Ahgpay / AHG Pay | 3 | 0 | 2 |
| Digitoys (requested Cryptoys) | 0 | 2 | 0 |

Missing rename/page identity context caused foreseeable false rejects on
Willow → Because and both Digitoys cases. Klipy was 1 accept/1 ambiguous; Raiqon
was 1 accept/2 ambiguous, including the gate case; and Ahgpay was 3 accept/2
ambiguous. These results show that conservative withholding can reject
legitimate current renames when the page identity evidence is absent.

Userpilot demonstrates the complementary failure: conservative instructions
did not make the veto safe enough. The gate therefore fails for precision and
safety, not merely for recall.

## Packet readiness and integrity

Preparation covered 2,277 candidates. Of these, 2,275 had recoverable image
bytes and 2,261 were renderable: 2 candidates were missing bytes and 14 were
renderer exclusions. Declared identity fields were empty, and the fresh
current-main challenge source was absent. The packet and validation checks
passed: structural validation passed, packet membership was disjoint as
required, and deterministic packet regeneration passed. No external network
calls were made.

The frozen packet limitations mean these judgments are context-limited. They do
not justify silently treating the result as a clean, fully contextualized
calibration or as holdout evidence.

## Time and cost accounting

The reviewer tasks ran concurrently. Orchestration recorded approximately
136.4 wall-clock seconds for the harmful task and 102.0 seconds for the
hard-legitimate task, or 238.4 aggregate task-seconds across 38 judgments:
6.27 task-seconds per judgment. These are orchestration task times, explicitly
not model latency. Subscription tokens and dollars were unavailable; actual
marginal dollars are recorded as unavailable, not $0.

## Stop decision and retest trigger

Classification is **STOP/NO-GO — precision-limited under context limitation**.
Do not start or propose the balanced pilot or full manifest under this
configuration, and do not proceed to Workstream 2.

The smallest legitimate retest is a new prompt version plus restored and frozen
page-identity context, followed by a complete harmful/hard gate from scratch.
Do not quietly tune on these answers and reuse them as holdout evidence. A new
calibration cache and fresh judgments are required for any retest.
