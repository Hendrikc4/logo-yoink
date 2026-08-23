<p align="center">
  <a href="https://logo-yoink.com"><img src="public/favicon-32.png" width="96" height="96" alt="Logo Yoink favicon"></a>
</p>

<h1 align="center">Logo Yoink</h1>

<p align="center">
  <strong>Drop in a website. Ride away with its best logos.</strong>
</p>

<p align="center">
  <a href="https://logo-yoink.com/">Try the live demo</a>
  ·
  <a href="#quick-draw">Run it yourself</a>
  ·
  <a href="#use-the-api">Use the API</a>
</p>

<p align="center">
  <img alt="Node.js 22+" src="https://img.shields.io/badge/Node.js-22%2B-3c873a?style=flat-square">
  <img alt="MIT licensed" src="https://img.shields.io/badge/license-MIT-f0a23b?style=flat-square">
  <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-yes-31a8ff?style=flat-square">
</p>

<p align="center">
  <img src="public/assets/readme/logo-yoink-flow.webp" alt="Pixel-art cowboy lassoing square, wide, and favicon logo assets out of a browser">
</p>

Logo hunting should not feel like archaeology. Give Logo Yoink one URL and it finds the real image files a site exposes, checks that they work, removes duplicates, and ranks the best choices for:

- **Icon** — apps, avatars, and square UI
- **Wordmark** — headers, cards, and wider layouts
- **Favicon** — tabs and tiny surfaces

You get the candidates, their evidence, and downloadable files. No mystery black box. No invented logos.

## Quick draw

You need [Node.js 22+](https://nodejs.org/).

```bash
git clone https://github.com/Hendrikc4/logo-yoink.git
cd logo-yoink
npm install
npm start
```

Open **http://127.0.0.1:4310**, paste a website, and hit **Yoink it**.

> There is also a cowboy runner up top. Jump the cacti, collect logos, and grab a lasso to auto-yoink the next three. Space, Arrow Up, W, and taps all work. 🤠

## Use the CLI

See the ranked results as JSON:

```bash
npm run cli -- stripe.com
```

Or download the top pick:

```bash
npm run cli -- stripe.com --download ./downloads/stripe
```

## Use the API

Once the local server is running:

```bash
curl -sS http://127.0.0.1:4310/api/extract \
  -H 'content-type: application/json' \
  -d '{"website":"stripe.com"}'
```

The response includes `selectedByRole`, grouped `assetFamilies`, every ranked `candidate`, and discovery `diagnostics`.

## What gets yoinked?

<table>
  <tr>
    <td width="112" align="center"><img src="public/assets/ui/feature-lasso-browser.png" width="88" alt="Pixel-art lasso around a browser window"></td>
    <td><strong>The obvious stuff</strong><br>Visible header images, picture sources, safe inline SVGs, and lazy-loaded assets.</td>
  </tr>
  <tr>
    <td width="112" align="center"><img src="public/assets/ui/feature-sheriff-badge.png" width="88" alt="Pixel-art sheriff badge"></td>
    <td><strong>The hidden clues</strong><br>Schema.org data, metadata, manifests, touch icons, mask icons, tiles, and favicons.</td>
  </tr>
</table>

Every candidate is downloaded, byte-validated, deduplicated, and scored with role-specific rules. If the fast static pass misses an icon or wordmark, the web app can make a bounded Playwright pass for JavaScript-rendered assets.

<details>
<summary><strong>Need more horsepower?</strong></summary>

The default path is intentionally homepage-only. Turn on the heavier fallbacks only when you need them.

| Need | How |
| --- | --- |
| Skip browser rendering | `BROWSER_DISCOVERY=0 npm start` |
| Recover from blocked or unusable homepages | Add `JINA_API_KEY` to `.env.local` |
| Use a local [Besticon](https://github.com/mat/besticon) fallback | `BESTICON_URL=http://127.0.0.1:8080 npm start` |
| Follow likely brand/press pages in the CLI | Add `--deep-wide` |
| Inspect one same-origin SPA bundle too | Add `--deep-wide --spa-bundles` |

Logo Yoink automatically loads a gitignored `.env.local` file. Normal successful extractions do not use Jina.

`--deep-wide` only runs when the homepage has no accepted wide logo. It follows at most two strong first-party brand, press, or media links and can inspect official ZIP kits. `--spa-bundles` scans at most one same-origin entry bundle, up to 2.2 MB, for a company-logo asset literal.

</details>

<details>
<summary><strong>Developing and benchmarking</strong></summary>

Run the tests:

```bash
npm test
```

The main trail map:

```text
src/discover-static.mjs   find candidates in HTML and metadata
src/discover-browser.mjs  render the bounded browser fallback
src/discover-deep.mjs     inspect official brand paths and kits
src/rank.mjs              score icons, wordmarks, and favicons
src/extractor.mjs         validate, deduplicate, and orchestrate
src/server.mjs            serve the tiny local web app and API
src/cli.mjs               print results or download the winner
```

The repository also includes frozen 100- and 500-company cohorts for repeatable extraction experiments. Start a benchmark with:

```bash
npm run benchmark -- --cohort original-100 --output runs/my-run
npm run review-montage -- runs/my-run
```

See [`docs/`](docs/) for the benchmark methodology, experiment logs, and visual-labeling workflow.

</details>

<details>
<summary><strong>A few honest limits</strong></summary>

- Some websites block automated clients.
- A site may expose a product icon instead of its company logo.
- Dimensions cannot reveal every padded or awkward wordmark.
- Redirected and rebranded domains can serve stale identity assets.

That is why Logo Yoink returns multiple ranked candidates instead of pretending one guess is always perfect.

The server binds to localhost by default and rejects non-public targets while revalidating redirects. The included public demo route also enforces small JSON-only requests, same-origin browser calls, per-client and global rate limits, a two-extraction concurrency ceiling, duplicate-request coalescing, bounded extractor work, generic errors, and restrictive browser security headers. Jina (when `JINA_API_KEY` is configured) and local browser discovery are enabled as bounded missing-logo fallbacks. Set `PUBLIC_DEMO_ALLOW_JINA=0` or `PUBLIC_DEMO_BROWSER=0` to opt out.

The in-process rate limiter is intentionally dependency-free, so limits apply per running instance. A multi-instance public deployment should add a distributed edge rate limit or authentication, and should pin the validated public IP at connection time or enforce equivalent outbound-network rules to close the remaining DNS-rebinding window.

</details>

<p align="center">
  <img src="public/assets/game/cowboy-horse.png" width="260" alt="Pixel-art cowboy riding a horse">
</p>

<p align="center"><strong>Happy yoinkin’.</strong></p>

Released under the [MIT License](LICENSE).
