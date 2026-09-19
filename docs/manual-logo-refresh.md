# Manually refresh the logo library

Run this whenever you choose: monthly, every six months, or for an individual rebrand. Nothing is scheduled. A refresh collects candidates; the approved library changes only when you approve the reviewed run.

## Ask Codex to do it

Open this project and use:

> Manually refresh the 1,000-brand logo library using docs/manual-logo-refresh.md. Check for current artwork, retain existing good logos when sources fail or new candidates are worse, review changed artwork, and update the approved library and contact sheets. Preserve theme, representation, variants, provenance, and usage notes. Summarize replacements, additions, and unresolved checks. Commit the result locally. Do not schedule recurring runs or deploy it.

For a smaller refresh, replace “1,000-brand” with the names or domains you want checked. Deployment can be requested separately when you want the updated library on the live site.

## 1. Start from the existing library

Run commands from the repository root, with dependencies installed (`npm ci` on a fresh checkout). Check the working tree so unrelated edits are preserved.

```sh
git status --short
node scripts/brand-library.mjs verify --root brand-library/v2
node scripts/brand-library.mjs coverage --root brand-library/v2
```

Keep the existing roster and manifest. `brands:1000:build` and `bootstrap` are roster construction tools, not maintenance steps. Always include `--root brand-library/v2`; the script otherwise defaults to the old 100-brand pilot.

## 2. Collect a refresh

For the whole library:

```sh
node scripts/brand-library.mjs refresh --root brand-library/v2 --workers 2
LOGO_RUN=$(node -p "require('./brand-library/v2/latest-run.json').runId")
printf '%s\n' "$LOGO_RUN"
```

Alternatively, use one of these scopes instead of the full command:

```sh
# Selected brands: IDs or canonical domains, separated by commas.
node scripts/brand-library.mjs refresh --root brand-library/v2 --only microsoft,apple.com --workers 2

# A batch of 100. Use --start 100, 200, ... 900 for later batches.
node scripts/brand-library.mjs refresh --root brand-library/v2 --start 0 --limit 100 --workers 2
```

Capture `LOGO_RUN` immediately after whichever refresh you use. Finish reviewing/approving that batch before moving on. The collector bypasses the approved runtime cache and performs live discovery. Downloaded candidates do not replace approved artwork.

The results are in `brand-library/v2/runs/<LOGO_RUN>/report.json`. Note the printed run ID if you will return later; in a new terminal, set `LOGO_RUN` to that exact ID. All remaining commands pin that run explicitly.

If collection was interrupted, repeat the same scope with `--resume-run "$LOGO_RUN"`. It reuses saved successful evidence. To retry a failed brand or deliberately fetch fresh evidence, start a new `refresh --only ...` run instead.

## 3. Review what changed

```sh
node scripts/brand-library.mjs review --root brand-library/v2 --run "$LOGO_RUN" --compact
```

Open the generated light and dark PNGs under `brand-library/v2/review/staged/<LOGO_RUN>/`. Compare replacements with the currently approved sheets in `brand-library/v2/review/` and the `previous`/`candidate` entries in the run report.

| Report classification | What to do |
| --- | --- |
| `unchanged`, `equivalent_artwork_new_url` | Bytes match the old artwork. Usually no new visual research is needed; preserve existing role/theme metadata. |
| `better_quality_same_artwork`, `equivalent_artwork_new_bytes` | Check that the new file is actually as good or better. |
| `possible_rebrand` | Compare with the current official site or brand page. A different download can be another layout or a wrong logo, not necessarily a rebrand. |
| `new_asset` | Check identity, intended role, and legibility before filling the gap. |
| `blocked_or_missing_retained`, `missing_unapproved` | Keep the approved file where one exists. Record the unresolved check; failure is not evidence that the company stopped using its logo. |

Reject wrong companies, generic UI icons, photos, obsolete artwork, and quality regressions. Valid native-size favicons and intentional monograms are acceptable icons. A legitimate mark that works on only one background is acceptable with the correct theme. Company-name logos can be horizontal, stacked, or compact.

In `report.json`, make sure candidates being accepted have the right `theme` (`light`, `dark`, or `any`) and `representation` (`symbol`, `wordmark_or_lockup`, `stacked_lockup`, or `compact_wordmark`). The live refresh does not automatically preserve all curated metadata. For byte-identical candidates, retain the approved metadata rather than replacing it with generic defaults; for example, retain `dark` and `stacked_lockup` where already reviewed. Approval retains existing variants and brand notes. If a real rebrand makes a stored variant obsolete, review that variant too before retaining it.

### Artwork previously found manually

The refresh command crawls websites; it does not monitor every saved Commons file or brand-kit URL. For manually sourced artwork that the crawler cannot rediscover, consult the approved asset's `sourceUrl`, `discoveryPage`, and provenance. Compare with current official branding when checking for a rebrand. An unchanged third-party download alone does not confirm current branding.

If a better direct file is found, stage it as a separate targeted run using `scripts/brand-library-stage-deep-search.mjs --root brand-library/v2 --input <candidates.json>`, then capture that new run ID and follow the same review/approval steps. The input shape is shown in [the existing deep-search records](../brand-library/v2/deep-search/part-a.json): a `results` array of `brandId`, `status: "candidate"`, and `candidates` with `role`, `url`, `discoveryPage`, `sourceKind`, `theme`, and `representation`. Use a verified public artwork URL. Keep existing artwork when the check remains unresolved.

## 4. Record decisions and approve that run

Create `brand-library/v2/review-refresh-<LOGO_RUN>.json` after review. Use this shape, replacing the run ID and timestamp:

```json
{
  "runId": "THE-EXACT-RUN-ID",
  "reviewer": "Codex/manual review",
  "reviewedAt": "ACTUAL-REVIEW-TIME-IN-ISO-FORMAT",
  "decisions": []
}
```

Put each rejected candidate in `decisions`, using its actual brand ID and role. For example: `{"brandId":"microsoft","role":"logo","action":"reject","reason":"Keep the approved logo; the new candidate is a worse crop."}`. This is a format example, not a rejection to copy unconditionally. You can also reject an unchanged candidate with the reason “Retain the existing approved file and metadata.”

**Every remaining candidate not rejected by `curate` will be promoted by `approve`.** An empty decisions array means you reviewed and accept all staged candidates; it is not a dry run. Reject or defer anything you have not accepted. Rejection retains an already approved asset for that role.

```sh
node scripts/brand-library.mjs curate --root brand-library/v2 --run "$LOGO_RUN" --decisions "review-refresh-$LOGO_RUN.json"
node scripts/brand-library.mjs approve --root brand-library/v2 --run "$LOGO_RUN"
```

If nothing should change, simply leave the run staged and skip approval. You can stop and return to a staged run at any time. A run is a comparison with the library when collection began; review again if another refresh has since changed the same brands.

## 5. Verify and make the result available

```sh
node scripts/brand-library.mjs verify --root brand-library/v2
node scripts/brand-library.mjs coverage --root brand-library/v2
node scripts/brand-library.mjs review --root brand-library/v2
npm run brands:runtime
git diff --stat
git diff -- brand-library/v2/manifest.json
```

Check that previously covered brands remain covered, changes match the review, and the new artwork renders. Record a short summary of replacements, additions, and failed/unresolved checks. An attempted or blocked check is not a confirmed-current logo. For an artwork-only update, manifest verification and visual review are the main checks; run `npm run check` if collection/runtime code was also changed.

Commit the manifest, newly approved asset files, review decisions, approval history, refreshed contact sheets, and summary. Stage new assets referenced by the manifest rather than every downloaded candidate. Local `runs/` and the generated `brand-library/runtime/` bundle are ignored; retain the review decisions and summary in Git so the outcome survives without local run files. Never delete old immutable artwork during a routine refresh.

Restart a running local app to pick up the updated manifest; the runtime caches it in memory. The live site needs a deployment, and package consumers need an updated package release. Their builds regenerate the approved runtime bundle. A local refresh does not publish or deploy anything automatically.
