import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { internals } from '../src/extractor.mjs';
import { scanEntryBundle } from '../src/discover-deep.mjs';

async function validatedSvg(markup, evidence = {}) {
  return internals.validateCandidate({
    url: `data:image/svg+xml;base64,${Buffer.from(markup).toString('base64')}`,
    source: 'inline-svg',
    evidence,
  }, 1_000, { requests: 0, bytesDownloaded: 0 });
}

test('Chromium renders Hoshii-style canonical cards and a SPA-discovered wordmark', async () => {
  const hoshiiIcon = await validatedSvg('<svg width="1024" height="1024" viewBox="0 0 1024 1024"><circle cx="512" cy="512" r="448" fill="currentColor"/></svg>', { inherited_color: '#7c3aed' });
  const hoshiiIconReverse = await validatedSvg('<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="currentColor"/></svg>', { inherited_color: '#ffffff' });
  const hoshiiLogo = await validatedSvg('<svg viewBox="0 0 180 36"><path fill="currentColor" d="M0 4h176v28H0z"/></svg>', { inherited_color: '#111827' });
  const hoshiiOther = await validatedSvg('<svg viewBox="0 0 48 48"><path fill="#7c3aed" d="M4 4h40v40H4z"/></svg>');
  assert.ok(hoshiiIcon && hoshiiIconReverse && hoshiiLogo && hoshiiOther);

  const icon = { ...hoshiiIcon, family_id: 'family-icon', variant: { theme: 'light', color: 'color', background: 'transparent' }, confidence_band: 'high' };
  const reverseIcon = { ...hoshiiIconReverse, family_id: 'family-icon-reverse', variant: { theme: 'dark', color: 'white', background: 'transparent' }, confidence_band: 'high', certainty: { score: 82, band: 'high' } };
  const logo = { ...hoshiiLogo, family_id: 'family-logo', confidence_band: 'high' };
  const other = { ...hoshiiOther, family_id: 'family-other', confidence_band: 'high' };

  const [spaCandidate] = scanEntryBundle('const logo="assets/pnp-logo.svg";', {
    scriptUrl: 'https://www.plugandplaytechcenter.com/main-X.js',
    homepage: 'https://www.plugandplaytechcenter.com/',
    companyName: 'Plug and Play Tech Center',
  });
  assert.equal(spaCandidate.url, 'https://www.plugandplaytechcenter.com/assets/pnp-logo.svg');
  const pnpLogo = await validatedSvg('<svg viewBox="0 0 144 40"><rect width="144" height="40" rx="3" fill="#111"/><path fill="#fff" d="M8 10h128v20H8z"/></svg>');
  assert.ok(pnpLogo);

  const payloads = {
    hoshii: {
      domain: 'hoshii.ai', assets: { icon, logo }, assetVariants: { icon: [icon, reverseIcon], logo: [logo] },
      selectedByRole: { icon, wide: logo, favicon: null },
      candidates: [icon, reverseIcon, logo, other],
      assetFamilies: [
        { id: 'family-icon', candidateIndexes: [0], representativeIndex: 0 },
        { id: 'family-icon-reverse', candidateIndexes: [1], representativeIndex: 1 },
        { id: 'family-logo', candidateIndexes: [2], representativeIndex: 2 },
        { id: 'family-other', candidateIndexes: [3], representativeIndex: 3 },
      ],
      diagnostics: { validated: 4, families: 4, durationMs: 10 },
    },
    pnptc: {
      domain: 'plugandplaytechcenter.com', assets: { icon: null, logo: pnpLogo },
      selectedByRole: { icon: null, wide: pnpLogo, favicon: null },
      candidates: [pnpLogo], assetFamilies: [], diagnostics: { validated: 1, families: 1, durationMs: 10 },
    },
  };
  const publicRoot = resolve('public');
  const server = createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/api/extract') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const website = JSON.parse(body).website;
      const payload = /pnptc/i.test(website) ? payloads.pnptc : payloads.hoshii;
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify(payload));
    }
    const path = resolve(publicRoot, request.url === '/' ? 'index.html' : request.url.slice(1));
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.ttf': 'font/ttf' }[extname(path)] ?? 'application/octet-stream';
    try { const bytes = await readFile(path); response.writeHead(200, { 'content-type': mime }); response.end(bytes); }
    catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.locator('#website').fill('hoshii.ai');
    await page.locator('#extract-form button[type="submit"]').click();
    await page.locator('#results').waitFor({ state: 'visible' });
    const hoshiiDimensions = await page.locator('.role-card [data-asset-image]').evaluateAll(images => images.map(image => ({
      complete: image.complete, naturalWidth: image.naturalWidth,
    })));
    assert.equal(hoshiiDimensions.length, 2);
    assert.ok(hoshiiDimensions.every(item => item.complete && item.naturalWidth > 0), JSON.stringify(hoshiiDimensions));
    const squarePreviewPlacement = await page.locator('.role-card').first().locator('.preview').evaluate(preview => {
      const image = preview.querySelector('[data-asset-image]');
      const previewBox = preview.getBoundingClientRect();
      const imageBox = image.getBoundingClientRect();
      return {
        contained: imageBox.left >= previewBox.left && imageBox.right <= previewBox.right
          && imageBox.top >= previewBox.top && imageBox.bottom <= previewBox.bottom,
        centerDeltaX: Math.abs((imageBox.left + imageBox.width / 2) - (previewBox.left + previewBox.width / 2)),
        centerDeltaY: Math.abs((imageBox.top + imageBox.height / 2) - (previewBox.top + previewBox.height / 2)),
      };
    });
    assert.equal(squarePreviewPlacement.contained, true);
    assert.ok(squarePreviewPlacement.centerDeltaX < 1, JSON.stringify(squarePreviewPlacement));
    assert.ok(squarePreviewPlacement.centerDeltaY < 1, JSON.stringify(squarePreviewPlacement));
    await page.waitForFunction(() => [...document.querySelectorAll('.role-card.selected .preview')]
      .every(preview => preview.dataset.previewBackground === 'white'));
    const iconVariant = page.locator('[data-asset-variant="asset-1"]');
    assert.equal(await iconVariant.locator('option').count(), 2);
    await iconVariant.selectOption('1');
    assert.equal(await page.locator('.role-card').first().locator('[data-asset-image]').getAttribute('src'), reverseIcon.dataUrl);
    await page.waitForFunction(() => document.querySelector('.role-card.selected .preview')?.dataset.previewBackground === 'black');
    await page.locator('.role-card').first().locator('[data-preview-background="transparent"]').click();
    await iconVariant.selectOption('0');
    assert.equal(await page.locator('.role-card').first().locator('.preview').getAttribute('data-preview-background'), 'transparent');
    assert.equal(await page.locator('#family-grid .family-card').count(), 1);
    assert.match(await page.locator('#complete-results summary').innerText(), /More assets \(1\)/);

    await page.locator('#website').fill('pnptc.com');
    await page.locator('#extract-form button[type="submit"]').click();
    const pnpImage = page.locator('.role-card [data-asset-image]');
    await pnpImage.waitFor();
    assert.equal(await pnpImage.evaluate(image => image.complete && image.naturalWidth > 0), true);
  } finally {
    await browser.close();
    await new Promise(resolveClose => server.close(resolveClose));
  }
});
