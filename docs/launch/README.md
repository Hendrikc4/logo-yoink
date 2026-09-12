# Launch demo and verification

[20-second demo](demo.webm): real local browser capture of the finder, a Stripe extraction, and a wordmark download. The capture is accelerated approximately 1.72×; it is not an extraction-speed benchmark. No responses were mocked. This is the branch UI served locally, not a deployed release.

## Recording script (20 seconds)

Use a 1440×900 browser, start at the top, and keep sound off.

- 0–3s: “Company icons and wordmarks. One URL. One yoink.” Show the finder.
- 3–6s: Enter `stripe.com`, then click **Yoink it**.
- 6–10s: Show the train while extraction runs. If necessary, cut the wait and label it “wait shortened”; never imply a fixed extraction time.
- 10–16s: Show Icon and Wordmark, then download the wordmark. “Download the actual files the site exposes.”
- 16–20s: Show the optional star link and cowboy scene. “Open source. Self-hostable. No API key.”

## Analytics

The existing Vercel Web Analytics queue now receives:

| Event | Allowed data |
| --- | --- |
| `extraction_started` | None |
| `extraction_finished` | `outcome`: success, empty, error |
| `asset_download` | `placement`: recommended, more_assets |
| `github_clicked` | `placement`: result, page |

A download event records a click, not a confirmed save. Success means the API returned candidates; a role can still be empty. The star CTA only appears when a recommended download exists. Aborted/superseded requests are excluded from completion events.

No website input, asset URL, filename, or error text is sent in custom data. Page URL query strings and fragments are removed through `beforeSend`. Privacy regression tests enforce the event allowlist. Custom event collection requires the appropriate enabled Vercel analytics plan; this change does not change billing or project settings. Local self-hosting has no Vercel ingestion endpoint (the existing insights script returns 404 locally).

Reference: [Vercel custom events](https://vercel.com/docs/analytics/custom-events).

## Verification

- Clean `npm ci`, including the Chromium install hook.
- Standalone `npm install github:Hendrikc4/logo-yoink` in a new temporary directory, including Chromium installation and a successful `yoink` API import.
- `npm run check`: syntax, benchmark qualification, 323 tests, fixture validation, local smoke.
- Real browser extraction for `stripe.com`; icon and wordmark SVG downloads.
- Mobile 390×844: no horizontal overflow; form ends at approximately 458px.
- Analytics event payloads inspected in the local queue; dedicated privacy/click tests pass.

Existing limitation: the lockfile's sharp version triggers advisory GHSA-rgj7-g3m4-5g8c (`npm audit`). Dependency remediation is outside this launch UI change. No deployment or merge performed.
