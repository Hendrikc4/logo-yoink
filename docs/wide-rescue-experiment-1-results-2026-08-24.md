# Experiment 1: existing-candidate wide rescue

Date: 2026-08-24  
Baseline: `94161db88442fcfce2a9ecba72eb2325c8bc6eff`  
Decision: **drop all treatments; report only**

## Outcome

No treatment met the keep criteria. Strict logo-path evidence and strongly gated shape edges produced no development changes. Visible header mapping changed nine already-correct development selections, added no correct answer, and reduced `best_selected` from 98 to 95. Narrow foreign-name relief added one correct development answer (Tapin2), but its one validation change was a clearly foreign “LEON CASINO” logo for Haryon/Knock Knock. The frozen candidate label incorrectly calls that asset correct. Blind-reviewed incremental accuracy was therefore 1/2 (50%), below the required 90%.

No ranking, replay, or test code is retained. Evaluation was not replayed or used for tuning.

## Reproducible 17-case ledger

The ledger is the deterministic join of current-identity captures, adjudicated candidate labels, and stored selections: include an entity when at least one candidate is labeled `identity=correct` with role `wide`, but its stored wide selection is absent or not role-correct. Categorize an eligible correct candidate as ordering; otherwise prefer generic veto, then out-of-band shape, then eligibility. This yields exactly 17 rows: development 9, validation 6, evaluation 2; eligibility 4, shape 5, identity veto 5, ordering 3.

Candidate identifiers below are the first eight hexadecimal characters after `candidate-`; every correct alternative and stored wide score is listed. `ratio` is raw/content-box (`—` means no measured content box). Evidence is `region; H=home-linked, T=positive logo token, N=company-name agreement, R=rendered or exact/derived visible mapping`.

| Company | Split | Stored selection | Labeled-correct alternatives (`id:score`) | Ratio | Evidence | Generic reason | Cause |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| Arcanite | development | abstain | `44169c04:63` | 3.24/— | body; H0 T1 N0 R1 | — | eligibility |
| Boostgrad | development | `c74b9a42` (correct brand, wrong role) | `8ba6af9c:52` | 6.23/— | body; H0 T1 N1 R1 | — | ordering |
| Lookiar | development | abstain | `b9cb8a9c:66`, `79dec1d7:66`, `30eb9757:84`, `1ac1830a:84` | 2.00/— | document; H0 T1 N0 R1 | — | eligibility |
| Modulize | development | abstain | `75165d93:70`, `fe58af65:63`, `93a44eb3:63`, `41bdb74e:63`, `a0debc22:63`, `a8a5bec0:63`, `581f2668:63`, `e844bb26:55`, `162f3e7c:55` | 7.11/— | body; H0 T1 N0 R1 | — | eligibility |
| Moku | development | abstain | `76bf5510:57`, `afb450a6:15` | 1.37/— | header; H1 T1 N1 R1 | — | shape |
| MY HEALTHY® | development | abstain | `ce630a8a:35` | 1.65/— | head; H0 T0 N0 R0 | — | shape |
| Oly Platform | development | abstain | `bc1adda7:39`, `2dae55ca:39`, `46c168de:31`, `41b3d7b5:4`, `9ec1cae0:0` | 1.00/— | body; H1 T1 N1 R0 | — | shape |
| Sessionmusic | development | abstain | `d817667f:0` | 1.31/— | document; H0 T1 N0 R1 | foreign named logo | identity veto |
| Tapin2 | development | abstain | `59f93be5:0`, `4e3de44e:0` | 2.56/— | header; H0 T1 N0 R1 | foreign named logo | identity veto |
| ai\|coustics | validation | abstain | `9dc48720:0` | 4.52/— | body; H0 T1 N0 R1 | foreign named logo | identity veto |
| Barocal | validation | `9dd997d1` (wrong) | `93075db9:60`, `9b6eea7a:60`, `5a4874fb:60`, `82d6079c:60`, `3ba33632:60`, `67e59454:52` | 4.21/— | body; H1 T0 N0 R0 | — | ordering |
| Haryon (ex Knock Knock) | validation | abstain | `c9b0b998:0` | 2.35/— | header; H0 T1 N0 R1 | foreign named logo | identity veto* |
| Prometheus | validation | abstain | `88ce6c39:22`, `b88dc3f4:0` | 14.44/— | header; H1 T0 N0 R1 | — | shape |
| Strata | validation | abstain | `0b045fdd:73` | 3.67/— | nav; H0 T0 N0 R1 | — | eligibility |
| Zubachee | validation | abstain | `01881aa4:57`, `79a48535:39` | 1.09/— | header; H1 T1 N1 R1 | — | shape |
| Maxi Mobility | evaluation | `dbe6dc68` (wrong) | `b96497ff:100`, `00b8b28e:100`, `bfb6136a:100`, `1283442e:100`, `ae3661f3:100`, `765eb40e:87`, `b1f627e4:87`, `66bc8ccd:87`, `62de28f8:79` | 2.30/— | header; H1 T1 N1 R0 | — | ordering |
| Paradoxintelligence | evaluation | abstain | `0640c9ee:0` | 3.34/— | body; H0 T1 N0 R1 | foreign named logo | identity veto |

\* The row is reproducible from the frozen adjudicated label, but blind pixel review and frozen DOM `alt="Leon Casino"` evidence prove that `c9b0b998` is not Haryon/Knock Knock. The effective audited opportunity is therefore 16, not 17.

## Independent profile results

All development profiles replayed the full 225-current-entity development population. Labels were used only for outcome measurement, never as selection features.

| Profile | Wide churn | Correct additions | Incorrect additions | Existing correct lost | Wide role precision | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Baseline | — | — | — | — | 149/154 = 96.753% | control |
| Strict first-party header/nav logo-path evidence | 0 | 0 | 0 | 0 | 149/154 = 96.753% | drop: no gain |
| Foreign-name relief with strict placement/identity plus visible-map corroboration | 1 | 1 (Tapin2) | 0 | 0 | 150/155 = 96.774% | advance once to validation |
| Strongly gated 1.4–1.8 and 12–16 shape edges | 0 | 0 | 0 | 0 | 149/154 = 96.753% | drop: no gain |
| Exact/derived visible header mapping as close-score corroboration | 9 | 0 | 0 | 0 | 149/154 = 96.753% | drop: no recall gain; best hits −3 |

The nine mapping-only swaps were all the requested company, but exchanged variants for Userpilot, EyeTell, You Just Run, IsoTruss, The ARIA Network, Cymbiotika, Factris, Qualisure Diagnostics, and iTech Minerals. `best_selected` fell 98→95 and best-hit rate 68.056%→65.972%.

## Validation and threshold decision

Validation was consumed once after freezing the foreign-name profile. The stored-label replay changed one result, Haryon/Knock Knock, and reported it as correct. Blind review instead found the LEON CASINO asset; frozen page evidence independently records `alt="Leon Casino"`, and the known generic hash already identifies the accompanying favicon as a repurposed casino favicon.

Across development plus validation, the baseline was 201 role-correct wides out of 208 selections (96.635%). The treatment made two additions: Tapin2 correct and Haryon wrong by blind review. Corrected treatment precision is therefore 202/210 = 96.190%, and new-selection accuracy is 1/2 = 50.0%. Overall precision remains above 96%, and existing correct wide/icon/favicon selections have zero regressions, but the 90% new-selection gate fails. The treatment is dropped.

No profile changed icon or favicon selection. Offline replay added zero requests, zero bytes, and zero latency; fallback-only request count and p50/p95 latency deltas are all zero. No evaluation result was replayed.

Final verification: `npm test` passed all 167 tests and validated 500 unique company fixtures.

## Frozen artifacts

Read-only root: `runs/visual-benchmark-v1-500-v1/merged` (ignored local run data)

| Artifact | SHA-256 |
| --- | --- |
| `entities.jsonl` | `2f58d0f3d0ffadf8ac0dbeefaf0c0c94d5dceb31df3c8410c439893f1e1dc109` |
| `captures.jsonl` | `d283a527bf1afef7cac9eae208572717de8926cdd626cb3dc3a843baefc6a16a` |
| `candidates.jsonl` | `7fc8afe4fcfa6687a1d04a4eec930492c81a49695bae92a5e9c354993311eb10` |
| `mappings.jsonl` | `34c4df2b8911359ba3977da9add4e0ce2b9cda7e041ba131ee66ff78bf864232` |
| `visual-instances.jsonl` | `541d6daf03b640a365fd844b23cd8e4c5115934d849dbf057e8769ae7230e547` |
| `label-sheets-v3/candidate-labels-500-v1-adjudicated.jsonl` | `c8eb8bb3765213372d89943243aca3e03fbc5180b50f6b1737a4adc0abd3b050` |
| `label-sheets-v3/baseline-current-system-selections.jsonl` | `fd1fbc326c7077453d79d9c6107f9e1e40d60cd2e247ea027df2f2fc8fa31c5d` |
| `label-sheets-v3/baseline-current-system-v1.json` | `8b243d620fe0c910140395f57b221e10b620a382f499163c08b4cd5184ed02a0` |

The Haryon audit source is `captures/8833fe2c-37ff-5939-ae80-46b6503b3a98/page.json`; the rejected asset is `assets/3fd6f62baa3f816ac6eae8653433f12a9d37d979bfa8f376511625119147694c.svg`.
