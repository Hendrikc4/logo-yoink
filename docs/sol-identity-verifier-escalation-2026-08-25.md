# GPT-5.6 Sol identity-verifier escalation: negative result

Date: 2026-08-25
Decision: **FINAL STOP — do not dispatch the fresh holdout**

This was a negative Logo Yoink experiment. The escalation configured
`gpt-5.6-sol` with high reasoning and left the [identity-veto-v3
prompt](../prompts/identity-veto-v3.md) unchanged. Sol reviewed the same 38
development cases, fully contextualized with the frozen page context used by
the Luna retest. The prepared 120-case fresh holdout was not reviewed and
remains untouched.

## Development gate

Sol produced 13 accepts, 23 rejects, and 2 ambiguous judgments. The exact
confusion matrix from the [development score](../runs/identity-verifier-sol-calibration-2026-08-25/development-score.json)
was:

| Expected outcome | Accept | Reject | Ambiguous | Total |
|---|---:|---:|---:|---:|
| Correct | 11 | 2 | 2 | 15 |
| Wrong | 2 | 11 | 0 | 13 |
| Ambiguous | 0 | 10 | 0 | 10 |
| **Total** | **13** | **23** | **2** | **38** |

The two wrong accepts were Userpilot and Genopets. Accept precision was
exactly **11/13 = 84.615%**, below the 98% threshold, and the zero-wrong
accept gate failed with two harmful accepts. This makes the configuration
classification-precision-limited and ineligible for holdout dispatch.

The controls were mixed in the important way. Willow→Because was accepted
acceptably, and both Digitoys cases were accepted acceptably; Sol did not
systematically reject the required rename controls. All five Bhr wrong
controls were withheld. Those passes do not offset the decisive Userpilot and
Genopets safety failures.

## Cost and comparison

The reviewer task took approximately 844.3 seconds across 38 judgments, or
22.22 task-seconds per judgment. This is orchestration task wall time, not
model latency. Subscription token and dollar usage were unavailable. For
comparison, the Luna v2–v4 context retests used 668.5 aggregate task-seconds
across 114 judgments, or 5.86 task-seconds per judgment; Sol was therefore
worse on observed task-time as well as accept precision. The escalation does
not pay: it adds cost/time while still admitting harmful accepts.

The shared context freeze cost (58 domains, 58 successes, 95 requests,
22,392,513 bytes, with request-latency p50/p95 of 416/1,520 ms) is documented
in the [Luna context retest](luna-identity-verifier-context-retest-2026-08-25.md).
That is shared setup accounting and is referenced here, not double-counted as
Sol model latency or reviewer time.

## Final disposition

Sol has more correct accepts than Luna v3 (11 versus 9) and handles the
Willow→Because and Digitoys controls better, while withholding all Bhr wrong
controls. But its two wrong accepts make the safety gate fail, and its
84.615% accept precision is worse than Luna v3’s 90.000%. The escalation is
therefore a negative, classification-precision-limited result.

**FINAL STOP:** do not inspect or review the fresh holdout, do not start
Workstream 2, do not change frozen labels or judgments, and do not change the
benchmark score. Retain the untouched 120-case holdout for a future materially
different model or method.
