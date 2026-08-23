# Logo Yoink experiment log

This is the canonical running index of Logo Yoink experiments. Add every completed experiment here, including negative results, before considering the work finished. Detailed reports remain linked for methodology, per-domain review, and reproduction commands.

Availability counts mean that the automated pipeline selected a candidate for a role; they are not correctness claims. Promotion decisions require visual review of every changed selection and, when the development gate passes, a frozen holdout run.

Status vocabulary:

- **Kept** — enabled in the product path after development and holdout evidence.
- **Available, optional** — existing behavior retained behind an explicit option.
- **Iterate — precision-limited** — produced useful recall, but incorrect selections exceeded the shipping gate. Retest after a targeted precision guard, not by expanding discovery further.
- **Iterate — safety-policy** — reduced wrong-brand output, but unresolved identity/rebrand policy prevents default use.
- **Deferred** — plausible, but current evidence does not justify implementation cost.
- **Dropped** — tested and produced no useful net benefit or unacceptable risk.

A negative shipping decision does not always mean the underlying signal was useless. The detailed sections distinguish:

- **recall-positive, precision-limited** results, which are worth revisiting after a specific guard;
- **safety-positive, policy-limited** results, which need better identity evidence or labels;
- **zero-yield** results, which should not be rerun without a new cohort or materially different source;
- **supporting signals**, which may help review or vetoes but should not rank candidates on their own.

## Results at a glance

| Date | Experiment | Development outcome | Holdout outcome | Cost or risk | Status |
|---|---|---|---|---|---|
| 2026-08-22 | Precision-gated asynchronous browser warming for missing-wide domains | Precision-ranked original-100 wide 40→47; all seven additions visually confirmed correct; Bhr→RealReports vetoed | Precision-ranked holdout wide 58→62; all four additions visually confirmed correct; icon/favicon unchanged in both cohorts | Off-path cold cost: development about 2,021 requests/41 MB; holdout 1,494 requests/24.9 MB and 2.30/4.39 s browser p50/p95; warm replay zero network and byte-identical | **Kept — asynchronous/off-path** |
| 2026-08-22 | Full 500-company visual audit and false-positive exclusions | Complete labels: strict selected-role precision 94.35%→98.29%; definite wrong selections 23→0 | All 500 icon/wide selections reviewed; 26 slots changed, with 10 visually confirmed replacements and 16 withheld | Availability icon 359→349, wide 243→237, favicon 350→343; metadata/hash-only, zero runtime network/AI cost | **Kept** |
| 2026-08-22 | Generic platform, badge, and UI-asset exclusions | Labeled icon/wide precision 89.8%→94.3%; two wrong icons replaced, one wrong icon and two wrong wides withheld | Offline all-500 rerank changed only nine role slots across seven domains; three repeated Wix defaults removed | Icon −1, wide −2, favicon −4 in the stored 500 run; exact signatures only, zero network cost | **Kept** |
| 2026-08-22 | Role-aware fixed download budget with strong-evidence gate | Icon +2, favicon +3; removed false body-image candidates | Icon +2, wide +2, favicon +5 when combined with content bounds | Holdout requests/domain −26%; bytes/domain −59% for combined bundle | **Kept** |
| 2026-08-22 | Wide-only visual content bounds | Three correct padded wordmarks recovered; no icon/favicon flips | Combined bundle wide +2 after one false wide candidate was removed by the evidence gate | Bounded local Sharp scan; no network cost | **Kept** |
| 2026-08-22 | Existing synchronous browser fallback | Wide 42→48 (+6); confirms JS rendering has meaningful wide-logo recall | Not promoted to default | Requests 1,074→3,351; bytes about 104→159 MB; p95 about 3.6→7.5 s | **Available, optional — cost-limited** |
| 2026-08-22 | Inline/external CSS, root Apple icon, browserconfig | No selected-role gains | Not run | About +2.2 requests/domain | **Dropped** |
| 2026-08-22 | Brand/press pages and sitemap hints | No gains | Not run | 60 additional requests in treatment | **Dropped** |
| 2026-08-22 | Browser pseudo-elements, masks, shadow DOM, and frames | Mechanism worked in controls but found no cohort candidates | Not run | Browser complexity and crawl cost; prevalence unproven | **Deferred — prevalence-limited** |
| 2026-08-22 | BIMI | One DNS record in 100; no validated win | Not run | DNS/certificate validation and limited prevalence | **Dropped** |
| 2026-08-22 | Android/iOS association metadata | Associations found, no first-party logo win | Not run | Store identity and asset-rights ambiguity | **Dropped** |
| 2026-08-22 | GitHub, Wikidata, npm, and Simple Icons | No verified win | Not run | Identity ambiguity, rate limits, per-asset rights | **Dropped** |
| 2026-08-22 | Common Crawl and search-index hints | No current-domain verified win | Not run | Stale and expired-domain identity risk | **Dropped** |
| 2026-08-22 | OCR company-name agreement | Correct name agreement on 17% of sample and no observed wrong agreement, but no new role coverage | Not run | CPU/dependency cost; useful as corroboration, not discovery or ownership proof | **Deferred — supporting signal only** |
| 2026-08-22 | Perceptual hashing | Formed corroboration groups but added no coverage | Not run | Degenerate hashes on blank assets; repetition can reinforce the same wrong brand | **Deferred — supporting signal only** |
| 2026-08-22 | Press-kit prevalence | No press links in 25 missing-wide cases | Not run | Generic expansion had poor yield | **Dropped** |
| 2026-08-22 | Screenshot/canvas extraction | Controls were unreliable; no defensible win | Not run | High browser/vision cost and UI contamination risk | **Dropped** |
| 2026-08-22 | Asynchronous browser fallback for missing-wide domains | Wide 44→52 with no icon/favicon movement; 7/8 new selections correct | Not run because reviewed precision failed the gate | About 2,021 deferred requests and 41 MB cold-cache; one wrong-brand promotion | **Iterate — precision-limited** |
| 2026-08-22 | Off-domain identity quarantine | Removed two confirmed wrong-brand domains; accepted seven legitimate moves | One uncorroborated Mocksi→BriefHQ quarantine; eight moves accepted | Approximate suffix parsing, same-domain blind spot, and ambiguous pure renames | **Iterate — safety-policy** |
| 2026-08-22 | Off-domain quarantine against final 500 labels | Prior redirected selections contained 11 wrong labels; the precision filters removed them without a redirect policy | Final redirected set: 44 correct, 6 ambiguous, 0 wrong across 50 selected-role labels | A default quarantine would now withhold legitimate/ambiguous moves without a measured wrong-brand reduction | **Dropped as a default policy — review signal only** |
| 2026-08-22 | Structured identity quarantine challenge set | Fresh current-main run had zero known harmful selections to veto; strongest two-source rule had 2 confirmed false quarantines and 3 ambiguous quarantines | Frozen adversarial set covered all 23 historical wrong selections, all 10 final ambiguous labels, all 37 fresh off-domain redirects, and Bhr same-domain repurposing | Runtime could reuse homepage HTML, but every tested rule had zero current safety gain | **Dropped — negative result** |
| 2026-08-22 | Theme grouping and light/dark usability | Zero genuine variant pairs and zero corrected rescues | Not run because benefit was zero | Browser probe added 622 requests; classifier-only result | **Dropped** |
| 2026-08-22 | Multi-observation provenance bonus | Identical selected URLs in all 300 role slots | Not run because benefit was zero | Results grew about 16%; could reinforce wrong identities | **Dropped** |

## Retained mechanisms

### Precision-gated asynchronous browser warming

The deferred missing-wide browser queue now clears both promotion gates when replayed after the full precision rerank. The implementation is deliberately off the foreground path: [`warm-browser-observations.mjs`](../scripts/warm-browser-observations.mjs) queues only successful, reachable records with no selected wide logo, caps shared-Chromium concurrency at two, and writes content-addressed observations. [`replay-browser-observations.mjs`](../scripts/replay-browser-observations.mjs) performs a zero-network merge, rejects duplicate bytes and URLs before ranking, and marks every browser addition wide-only so icon and favicon cannot move.

A narrow identity-conflict veto applies only to deferred browser candidates. It recognizes an explicit home-linked accessibility declaration such as `RealReports Logo`, compares both tokens and compact spellings against the requested company and domain, and withholds a conflicting candidate. This rejects Bhr→RealReports while preserving spacing variants such as Ahgpay→AHG Pay. It is not a general rebrand classifier and does not loosen any existing generic-asset or content-image exclusion.

Results on the two frozen 100-company slices:

| Cohort | Precision-ranked control | Async treatment | Visually reviewed additions | Wrong-brand domains | Icon/favicon movement |
|---|---:|---:|---:|---:|---:|
| Original-100 | wide 40 | wide 47 | 7/7 correct | 0 | 0 |
| Holdout-100 | wide 58 | wide 62 | 4/4 correct | 0 | 0 |

The eleven additions are Scoped Solutions, TradeBridge, Grapple, Curiominds AI, Aryval, Utiq, TrialNav, Vention, MindCoord, Wora Delivery, and Rigly. Every stored asset was re-inspected on light and dark panels. Six are good on both backgrounds; Scoped Solutions, Aryval, Vention, MindCoord, and Rigly are conditional because contrast depends on the background. Incremental precision is 100%. Applied to the canonical 500-label baseline, selected availability becomes icon 349, wide 248, favicon 343. Strict icon/wide precision becomes 587/597 = 98.32%, determinate precision remains 100%, and wrong-brand domains remain zero. The benchmark delta from the eleven correct selections and their reviewed usability is +0.97, moving the canonical 71.97 baseline to 72.94 with foreground efficiency unchanged.

The development cache retained the earlier measured cold cost of about 2,021 deferred requests and 41 MB for 36 queued domains. The retained harness's holdout warm queued 27 domains, made 1,457 browser requests plus 37 validation requests, transferred 23.43 MB plus 1.49 MB of validated assets, and measured 2.30/4.39 seconds browser p50/p95. Repeating the holdout warm produced 27 cache hits, zero browser invocations, zero network requests, and byte-identical reranked output. These costs are acceptable only as asynchronous, cacheable enrichment; synchronous/default browser discovery remains rejected.

### Generic non-brand asset exclusions

Ranking now withholds a small set of visually verified non-brand assets: foreign platform wordmarks on placeholder/application pages, Matomo's default app assets, Wix's shared default favicon, SOC 2/footer trust badges, and common Font Awesome navigation controls. Provider-brand exclusions are bypassed when the requested company or source hostname is the provider itself. Namecheap parking pages and Vercel security checkpoints are also classified before asset discovery.

Offline reranking of the stored 500-domain artifacts changed nine role selections across seven domains. On the fully reviewed development 100, Fleetcraft's SOC 2 seal and Equi-rider's language control were replaced by correct first-party icons; the JUNO/Matomo icon and the Namecheap and Matomo wide logos were withheld. Correct icon/wide selections increased from 97/108 (89.8%) to 99/105 (94.3%). The stored all-500 availability moved from 365/249/354 to 364/247/350 because the treatment intentionally returns no asset instead of a known generic one. Three of the favicon removals were the same Wix default bytes on unrelated domains. No unreviewed icon or wide selection changed outside the known false-positive cases.

### Visually derived content and foreign-mark exclusions

A second pass reviewed every selected icon and wide asset in the stored 500-company montages, then inspected every old/new pair produced by reranking. Narrow metadata rules now reject social-network glyphs; inline play, chevron, and product-selector controls; Untitled UI template artwork; the observed WordPress default favicon; non-home-linked foreign named logos; semantically explicit product/mockup/dashboard/editor imagery; and unlinked square raster images from page content unless their URL or local semantics identify a logo or mark.

The completed audit contains 602 labels for the prior selected icon/wide assets: 568 correct, 23 wrong, and 11 ambiguous. The final rerank changes 26 role slots: 10 false positives are replaced by visually confirmed first-party marks, and 16 are withheld because no defensible alternative remains. It handles repeated platform defaults and foreign identities (Wix, WordPress, Create React App, GoDaddy, RealReports, and several reused gambling assets), plus visually recognizable navigation controls, play icons, copyright glyphs, partner/customer carousels, generic social cards, body illustrations, screenshots, and product imagery.

The final run selects 349 icons, 237 wide logos, and 343 favicons. Its 586 retained icon/wide labels contain 576 correct, zero definite wrong, and 10 ambiguous identity transitions. Strict precision, conservatively counting ambiguous selections as non-correct, is 98.29% (up from 94.35%). Precision among determinate labels is 100%; this should not be interpreted as population-perfect precision because the evaluation reuses the audited cohort. The benchmark score rises from 66.89 to 71.97, primarily because wrong-brand safety improves from 18 affected reachable domains to zero. Both the [`before`](../labels/review-500-before-precision-2026-08-22.jsonl) and [`final`](../labels/review-500-final-2026-08-22.jsonl) label artifacts are versioned.

### Role-aware candidate budget

The download ceiling remains 16, divided provisionally across icon, wide, and favicon candidates. Weak body images, negative-context candidates, and banners do not consume the protected role queues. A DOM image needs credible logo evidence such as a logo token, home link, or header/navigation placement.

Development moved from 66/42/67 to 68/44/70 when combined with content bounds. On holdout, the combined bundle moved from 75/57/72 to 77/59/77 while reducing requests and bytes. Visual review confirmed the new wide selections and found that several removed icon candidates were photographs, product mockups, or third-party UI assets.

### Wide-only content bounds

Credible wide candidates whose outer canvas is not wide enough receive one bounded 96×96 Sharp scan. Transparent or corner-colored padding is trimmed, and only the wide role consumes the resulting content ratio. This recovered Tenvos, Nui, and Lisa in development without changing icon or favicon scoring.

### Existing optional browser fallback

The synchronous browser fallback remains available explicitly because it recovers wide logos on JS-rendered sites. It is not the default: the development run gained six wide selections, moving 42→48, while requests increased 1,074→3,351, bytes increased from about 104 to 159 MB, and p95 latency increased from about 3.6 to 7.5 seconds.

This was not a precision failure; it was a response-path cost failure. The browser's existing discovery surfaces were useful, while added pseudo-element/mask/shadow/frame surfaces found nothing. The promising direction was therefore to move the existing browser work off the synchronous path and cache it, which led to the asynchronous experiment below.

## Promising but not retained

### Asynchronous browser warming

This was the largest round-two recall result. A two-phase Ox Alpha harness queued only reachable domains missing a wide selection, cached browser observations at concurrency two, and reranked offline. It gained eight wide selections with no icon/favicon movement. Cache replay made zero browser invocations and produced byte-identical output.

The eight new selections and their review verdicts were:

| Company/domain | Result | Review |
|---|---|---|
| TradeBridge | First-party PNG wordmark and tagline | Correct; usable on light and dark |
| Curiominds AI | First-party Next.js SVG wordmark | Correct; usable on light and dark |
| Utiq | First-party PNG wordmark | Correct; usable on light and dark |
| TrialNav | First-party WebP mark and wordmark | Correct; usable on light and dark |
| Aryval | Header inline SVG wordmark | Correct; dark-only |
| Scoped Solutions | White masked SVG lockup | Correct; dark-only |
| Grapple | Header inline SVG after `cloudgrapple.com`→`askgrapple.com` | Correct canonical move |
| Bhr | RealReports wordmark from `bhr.fyi` | Wrong identity; current page declares RealReports |

Reviewed precision was 7/8 = 87.5%, below the predeclared 90% gate, so holdout was correctly not run. Importantly, the mechanism itself found useful logos; the blocker was identity precision, not recall or caching architecture. The Bhr domain already produced a wrong RealReports icon in the static control, but the async treatment expanded that wrong identity into the wide role, which still counts as a regression.

Cold-cache cost for 100 domains was 36 browser invocations, roughly 1,960 browser requests plus 61 validation requests, and about 41 MB. Browser p50/p95 was 2.46/4.55 seconds, entirely off the foreground path. A second warm used 36 cache hits, zero browser invocations, zero network, and produced byte-identical reranking output.

**Why it remains promising:** seven correct wide gains per 100 is materially larger than any other unretained coverage experiment, non-target roles stayed stable, and repeat cost fell to zero with deterministic caching.

**What must improve:** add a veto, not more discovery. Only promote a deferred browser result when current structured page identity does not strongly conflict with the fixture. Candidate evidence should remain wide-only, and dark-only assets should be annotated rather than treated as universally usable.

**Retest trigger:** a narrow JSON-LD organization/`og:site_name` conflict check that would reject Bhr/RealReports while preserving the seven correct cases. Require ≥95% reviewed precision and zero wrong-brand domains before holdout.

### Off-domain identity quarantine

A strict off-domain rule initially quarantined nine development domains, including six legitimate moves, and failed. A refined experiment accepted current first-party corroboration while quarantining RapidVerify→789BET and JUNO Nutrition→Matomo/Kleine. Holdout quarantined Mocksi→BriefHQ, whose page contains no Mocksi evidence; this is safe but could be an undocumented pure rename.

The refined development treatment removed exactly the two reproduced wrong-brand cases:

| Requested identity | Final content selected by control | Verdict |
|---|---|---|
| RapidVerify (`rapidverify.io`) | 789BET casino icon and wordmark from an unrelated betting domain | Correct quarantine |
| JUNO Nutrition (`spedition-kleine.de`) | Matomo application icon and Matomo wordmark from `auswertung.kleine.eu` | Correct quarantine |

It preserved legitimate or coherent moves including Cryptoys→Digitoys, Storyline, Willow, Grapple, Fleetcraft, Haze, and Mia. On holdout it also accepted eight corroborated moves. The only holdout quarantine was Mocksi→BriefHQ: BriefHQ is self-canonical and contains no Mocksi reference, so quarantine is safe for wrong-owner prevention, but without an external label it cannot distinguish a new owner from a clean rename.

The experiment is a safety improvement rather than a coverage improvement. It remains unported because it uses approximate registrable-domain parsing, cannot detect same-domain repurposing such as Bhr→RealReports, uses a permissive four-character substring signal, and introduces ambiguous rename policy.

**Why it remains promising:** it removed every reproduced off-domain wrong-brand selection at zero added network cost, while the refined rule avoided the strict rule's legitimate-move regressions.

**What must improve:** production-grade Public Suffix List parsing; explicit `accepted`/`quarantined`/`unresolved` states; reviewer labels for pure renames; and a separate strong structured-name conflict signal for same-domain repurposing. External evidence should resolve ambiguous cases, not increase string-heuristic complexity.

**Retest trigger:** a labeled set of off-domain redirects and same-domain repurposed sites large enough to measure both false quarantine and false acceptance. The current 200-domain evidence is directionally good but too small for default identity policy.

The completed 500-label audit now resolves the shipping question for the current cohort. Among domains classified as redirected off-domain in the stored all-500 run, the before-precision labels contained 41 correct, 11 wrong, and 7 ambiguous selected-role records. After the retained precision filters, the final labels contain 44 correct, zero wrong, and 6 ambiguous records. A separate default quarantine therefore has no residual wrong-brand yield to measure, while it would still discard uncorroborated moves such as Mocksi→BriefHQ. The broad policy is dropped from default consideration and retained only as a reviewer/diagnostic state. The browser-wide path uses its narrower candidate-level explicit-name veto because that has a reproduced same-domain failure and no observed false quarantine after compact-name normalization.

### Structured identity quarantine challenge-set retest

This retest built [`identity-quarantine-challenge-2026-08-23.json`](../labels/identity-quarantine-challenge-2026-08-23.json) from the union of every non-correct record in the two 500-company label files and every off-domain redirect in a fresh all-500 run at current main `1dc320b`. Its 51 entities include all 23 historical wrong selections, all 10 final ambiguous labels, all 37 fresh off-domain redirects, the known expired/reassigned domains, and Bhr→RealReports as the same-domain repurposing control. The fresh baseline reproduced 424 reachable sites and selected 367 icons, 243 wide logos, and 366 favicons. Its 63.4 availability proxy is live-network drift, not a replacement for the verified 71.97 quality baseline. The historical labels matched 572 of 610 fresh selected icon/wide slots, so the fresh quality score is correctly reported as incomplete.

The frozen observation contains only current strong structured identity declarations: JSON-LD Organization/Brand names and URLs, `og:site_name`, canonical URL, and `og:url`. Names were tested only as vetoes; URL fields remained diagnostic. Exact normalized equality was used, without substring acceptance, edit distance, or a positive ranking bonus. Three deterministic policies were evaluated offline:

| Veto policy | Historical harmful selections vetoed | Current harmful selections vetoed | Confirmed false quarantines | Ambiguous quarantines | Fresh icon/wide/favicon delta | Delta from verified 71.97 |
|---|---:|---:|---:|---:|---:|---:|
| Any structured-name conflict | 7 | 0 | 7 | 5 | −10 / −8 / −11 | −0.98 |
| Same foreign name in JSON-LD and `og:site_name` | 4 | 0 | 2 | 3 | −4 / −4 / −5 | −0.27 |
| Foreign hostname-shaped `og:site_name` | 3 | 0 | 1 | 0 | −1 / −1 / −1 | −0.18 |

Current main already withheld every selected role on the six historically harmful identity domains: Haryon/Knock Knock, Bhr, RapidVerify, BanterAI, NUMiX Materials, and Obseva. Consequently all policies produced zero current wrong-brand-domain reduction. The two-source policy falsely quarantined the visually confirmed Willow→Because move and Raiqon's correct mark because the site consistently declares `Raiqon AI`; it also quarantined unresolved Mocksi→Brief, BudID→Cetti, and SPIRL→Defakto transitions. The narrow hostname policy still falsely quarantined Klipy: `useklipy.com` legitimately serves Klipy while declaring `Klipy.ai`. Every would-be changed current selection was reviewed on light and dark montage panels; confirmed correct examples included Digitoys, Because, HUDU, Raiqon, Rapid Flight Training, Stak, and Klipy, while Penny, Cetti, Brief, Drip Labs/AC, and Defakto remained ambiguous. The harmful controls selected no current assets.

Freezing current observations succeeded for 50/51 homepages; JUNO Nutrition's fresh probe failed and remains represented by its run redirect and historical labels. The freeze cost 103 requests and 15.06 MB, with 404/1,828 ms p50/p95 and 32.49 seconds summed latency. A production implementation could reuse the already-fetched homepage HTML, so it would add no network requests or bytes, but this does not rescue the precision failure or create a current safety benefit. No product rule was implemented. Reproduce with `node scripts/identity-quarantine-challenge.mjs evaluate labels/identity-quarantine-challenge-2026-08-23.json`; use `freeze <all-500-run> <artifact.json>` only to intentionally refresh the web snapshot.

**Decision:** negative result. Zero false quarantines and a clear current safety benefit were both required; no tested rule met either half of that gate. Keep these fields as reviewer diagnostics only. Retest only when a verified current-main run contains residual harmful selections that the existing exact filters do not already withhold, or when external labels resolve the pure-rename cases.

## Supporting signals worth preserving as ideas

### OCR name agreement

OCR agreed with the expected company name on 17% of the inspected sample and produced no observed wrong agreement, but it did not recover a missing role or change a winner. That makes it unsuitable as a standalone discovery mechanism and too expensive for default ranking.

The result is still potentially useful as a precision feature on a very small ambiguous set—for example, deferred browser wide candidates that otherwise pass shape/source checks. A future test should measure whether OCR rejects partner/UI assets or confirms wordmarks, not whether it increases raw candidate count. It should never override a strong identity conflict, and absence of readable text must remain neutral because symbol-only logos are common.

The new async treatment does not meet that retest trigger: all eleven changed selections were resolved by first-party placement, explicit semantics, the identity veto, and visual review, with zero wrong-brand output. OCR would not add coverage or change a decision, so adding its CPU/runtime dependency would have zero measurable value here. It was not rerun or implemented.

### Perceptual and byte-level corroboration

Perceptual hashing found repeated assets, but repetition did not create coverage and blank/near-blank assets generated degenerate hashes. The later provenance experiment also showed that multi-source repetition can reinforce a wrong identity such as Willow/Because.

Hashing may still be useful for cache deduplication, montage grouping, and reviewer diagnostics. It should not add ranking points unless independent brand identity is already established. Exact byte hashes were useful in the async experiment because they prevented browser copies from displacing static candidates; that operational use is retained conceptually even though perceptual ranking bonuses are not.

The precision-gated replay confirms that boundary. Exact byte and URL hashes remain part of cache identity and pre-merge deduplication, where they prevent non-wide role movement. Perceptual corroboration would not change any of the eleven reviewed decisions and could still reinforce a coherent wrong owner, so no perceptual-hash ranking or runtime dependency was added.

### Search, archive, package, and registry hints

Common Crawl, search-index hints, app associations, GitHub, Wikidata, npm, and Simple Icons produced no verified current-domain win. Their shared blocker was identity, freshness, or asset rights—not necessarily the absence of logos.

They should only be reconsidered for a manually labeled miss set and only as URL/identity hints. Any asset would still need confirmation against the current first-party site, current domain ownership, and source-specific license. Archived bytes or registry assets should not become winners directly.

## Zero-yield or prevalence-limited experiments

### CSS and auxiliary pages

Inline/external CSS, root Apple icon, and browserconfig added about 2.2 requests/domain without a selected-role gain. Generic brand/press/sitemap expansion added 60 requests with no gain, and 25 missing-wide domains contained no press link. These are zero-yield results on the frozen cohort, not precision-limited wins. Revisit only if a labeled miss set specifically contains CSS-only or press-kit-hosted logos.

### Additional browser surfaces

Pseudo-elements, CSS masks, shadow DOM, and frames worked in mechanical controls but produced no cohort candidates. This is prevalence-limited rather than disproven. Do not pay the crawl and security complexity globally; add one surface only after real misses demonstrate it appears at least twice per 100.

### BIMI and store metadata

BIMI appeared once in 100 and yielded no validated win. App associations existed but did not produce a new first-party logo. BIMI may have high precision when present, but prevalence and certificate/DNS work make it a poor default investment. Store metadata additionally carries publisher/app/company identity and asset-rights ambiguity. Both need a targeted cohort with known records before reconsideration.

### Theme variants

The static treatment found four multi-member families, all resize variants of the same mark, and zero genuine light/dark pairs. A 16-domain browser probe invoked the browser eight times, spent 622 requests, and still found zero distinct theme bytes. The usability classifier labeled existing winners but created zero alternate usable slots. This is a zero-yield discovery result; revisit only with a cohort explicitly labeled as shipping separate theme assets.

### Screenshot and canvas extraction

Screenshot/canvas controls were unreliable and produced no defensible win. The risk is not only cost: header screenshots can contain navigation controls, partner marks, and text that looks logo-like. Reconsider only if JS canvas logos are confirmed misses and a bounded header-region extraction plus strong identity review can be evaluated separately.

### Multi-observation provenance bonus

After collapsing manifest/Apple/HTML/root icon declarations into one source category, control and treatment selected identical URLs in all 300 role slots. Fifty-three domains had multi-observation candidates, nine candidates received a bonus, and eight were already winners. The serialized results grew about 16% without benefit. This is not promising as a ranking feature; retain only compact diagnostic counters if future debugging needs them.

## Important negative findings

- Repeated discovery is not independent proof of brand ownership. Provenance bonuses changed no winner and reinforced some existing wrong-identity assets.
- Light/dark classification does not create theme coverage. The cohort contained no genuine discoverable variant pair, including a bounded browser probe.
- Generic auxiliary-page expansion is low yield. Press/about/sitemap crawling spent requests without selecting new correct logos.
- External registries and package metadata create an identity-resolution problem before they create a logo-source opportunity.
- OCR and perceptual similarity can support review, but neither produced incremental coverage in the tested cohorts.
- Off-domain redirects cannot be rejected wholesale; legitimate canonical moves and rebrands are common enough to require corroboration.
- Async browser discovery should remain wide-only. An early experiment bug showed that byte deduplication could otherwise displace an existing icon candidate even when browser observations were intended only for wide recovery.

## Next experiment

Do not iterate on default identity string matching. The retained exact asset filters and browser-candidate accessibility-name veto already remove the reproduced current failures. Reopen identity quarantine only for a newly verified residual harmful selection or after external labels resolve the pure-rename cases; continue to require zero false quarantines and a measured current-main wrong-brand reduction.

## How to record future experiments

For each completed experiment, append one row to the summary table and add detail when the result affects a decision. A failed shipping gate must say whether the experiment was precision-limited, cost-limited, prevalence-limited, policy-limited, or genuinely zero-yield. Record:

1. date, hypothesis, implementation flag, and exact cohorts;
2. control and treatment role counts;
3. feature-attributable changes separated from network/CDN drift;
4. visual verdict for every changed selection;
5. requests, bytes, latency, and browser invocations;
6. precision gate, stop conditions, and holdout decision;
7. useful signal observed, even if the mechanism was not retained;
8. exact blocker and the smallest change that could address it;
9. retest trigger and final status.

## Detailed reports

- [First-round coverage experiments](logo-coverage-experiment-results-2026-08-22.md)
- [Round-two coverage experiments](logo-coverage-experiment-results-round2-2026-08-22.md)
- [Coverage improvement plan](logo-coverage-improvement-plan.md)
- [Benchmark execution record](benchmark-execution-2026-08-22.md)
