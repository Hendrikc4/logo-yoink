import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { matchGenericFingerprint } from '../src/generic-asset-fingerprint.mjs';
import { measureTinyImageSuitability } from '../src/tiny-image-suitability.mjs';
import { genericAssetReason, rankCandidates } from '../src/rank.mjs';
import { internals } from '../src/extractor.mjs';

const fixture = name => new URL(`./fixtures/generic-favicons/${name}`, import.meta.url);

async function visualMatch(name) {
  const measured = await measureTinyImageSuitability(await readFile(fixture(name)));
  return matchGenericFingerprint(measured?.pixel_fingerprint);
}

test('matches resized and re-encoded Wix and WordPress generic favicon fixtures', async () => {
  for (const name of ['wix-192.png', 'wix-64.webp']) {
    const match = await visualMatch(name);
    assert.equal(match.family, 'wix');
    assert.equal(match.method, 'normalized-pixel-fingerprint');
  }
  for (const name of ['wordpress-80.png', 'wordpress-32.webp']) {
    const match = await visualMatch(name);
    assert.equal(match.family, 'wordpress');
    assert.equal(match.method, 'normalized-pixel-fingerprint');
  }
});

test('recognizes GoDaddy default branding when a favicon cache hides the provider URL', () => {
  const fingerprint = {
    version: 1,
    hash: 'ffc3818199c3e7ff',
    raster: 'AQEBAQEBAQEBAQMDAgMBAQEEBAcEBAQBAQUDBAUDBQEBBAcBAgYEAQEBBwUEBwEBAQEBAwMBAQEBAQEBAQEBAQ==',
    color: [24, 48, 48],
  };
  const match = matchGenericFingerprint(fingerprint);
  assert.equal(match.family, 'godaddy');
  assert.equal(match.method, 'normalized-pixel-fingerprint');

  const cached = {
    source: 'google-favicon',
    url: 'https://www.google.com/s2/favicons?domain=acme.test&sz=256',
    resolved_url: 'https://t1.gstatic.com/faviconV2?url=http://acme.test&size=256',
    observed: {
      byte_hash: '44ea786ef9f9ad7f0ee37ab3166580818da36d2cd2721f5a480cc8a06d801fa2',
      generic_asset: match,
    },
    width: 180,
    height: 180,
    highResolution: true,
    bytes: 2323,
    evidence: { element: 'cached-favicon', provider: 'google' },
  };
  const ranked = rankCandidates([cached], { companyName: 'Acme' });
  assert.match(genericAssetReason(cached, 'Acme'), /GoDaddy default PWA logo/);
  assert.deepEqual(ranked.candidates[0].predicted_roles, []);
  assert.equal(ranked.selectedByRole.icon, null);
  assert.equal(ranked.selectedByRole.favicon, null);

  assert.equal(genericAssetReason(cached, 'GoDaddy'), null);
  assert.equal(genericAssetReason({ ...cached, source_page: 'https://www.godaddy.com/' }), null);
});

test('recognizes re-encoded Lovable and Linktree platform defaults without blocking their owners', () => {
  const cases = [
    {
      family: 'lovable', owner: 'Lovable', reason: /Lovable default favicon/,
      fingerprint: { version: 1, hash: '60f0f8fcfefffe7c', color: [224, 136, 160],
        raster: 'DQgHCQ4PDw8IBwgICg8PDwcHBwgJDw8PBwcHBwcJCg8IBwcHBwYGCQgIBwcHBwcICAgIBwcHCAoJCAgICAgKDg==' },
    },
    {
      family: 'linktree', owner: 'Linktree', reason: /Linktree platform wordmark/,
      fingerprint: { version: 1, hash: '0001017f6f6dfe00', color: [176, 176, 248],
        raster: 'Dw8PDw8PDw4MDQ0PDw8NCAwNCwsPDw4FCwUJBgUHBgILCQULBwYIBwsJBQsICAsKBgkHCAgHCQwLDQ0MDQ0NDg==' },
    },
  ];
  for (const item of cases) {
    const match = matchGenericFingerprint(item.fingerprint);
    assert.equal(match.family, item.family);
    const candidate = { source: 'html-icon', url: 'https://acme.test/favicon.png', observed: { generic_asset: match }, evidence: {} };
    assert.match(genericAssetReason(candidate, 'Acme'), item.reason);
    assert.equal(genericAssetReason(candidate, item.owner), null);
  }
});

test('recognizes repeated template marks and foreign portfolio branding after recoloring', () => {
  const cases = [
    { family: 'template-chevron', company: 'EnerTech Capital', fingerprint: { version: 1, hash: '0081c3e77e3c1800', color: [255, 248, 255], raster: 'Dw8PDw8PDw8PDw8PDw8PDw4ODw8PDw4ODw8ODw8ODw8PDw8ODg8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw==' } },
    { family: 'hi-ventures', company: 'ALLVP', fingerprint: { version: 1, hash: '3c42a5bdadad423c', color: [176, 176, 176], raster: 'Dw0GBwcGDQ8NBg4PDw4HDQYPBQ8PCQ8HBw8EBwgGDwcHDwUOBwUPBwYPCA4JCA8GDQYPDw8PBw0PDQcHBwYNDw==' } },
  ];
  for (const item of cases) {
    const match = matchGenericFingerprint(item.fingerprint);
    assert.equal(match.family, item.family);
    assert.match(genericAssetReason({ observed: { generic_asset: match }, evidence: {} }, item.company), /chevron|Hi Ventures/);
  }
  const hiMatch = matchGenericFingerprint(cases[1].fingerprint);
  assert.equal(genericAssetReason({ observed: { generic_asset: hiMatch }, evidence: {} }, 'Hi Ventures'), null);
});

test('visual generic matches reject non-owners and retain owner assets with diagnostics', async () => {
  const cases = [
    { match: await visualMatch('wix-64.webp'), url: 'https://static.wixstatic.com/media/default.webp', owner: 'Wix' },
    { match: await visualMatch('wordpress-32.webp'), url: 'https://example.test/favicon.webp', owner: 'WordPress' },
  ];
  for (const { match, url, owner } of cases) {
    const candidate = { source: 'html-icon', url, observed: { generic_asset: match }, evidence: {} };
    assert.match(genericAssetReason(candidate, 'Acme'), new RegExp(`${match.reason} via normalized-pixel-fingerprint`, 'i'));
    assert.equal(genericAssetReason(candidate, owner), null);
  }
});

test('recognizes a mirrored Wix default without relying on its host', async () => {
  const match = await visualMatch('wix-64.webp');
  const mirrored = { source: 'html-icon', url: 'https://example.test/site-icon.webp', observed: { generic_asset: match }, evidence: {} };
  assert.match(genericAssetReason(mirrored, 'Acme'), /Wix default favicon via normalized-pixel-fingerprint/);
});

test('owner domains work without a company-name option and cannot be spoofed by hosted sites', async () => {
  const candidate = { source: 'html-icon', url: 'https://cdn.test/favicon.png',
    observed: { generic_asset: await visualMatch('wix-192.png') }, evidence: {} };
  assert.equal(genericAssetReason({ ...candidate, source_page: 'https://www.wix.com/' }), null);
  for (const source_page of ['https://wix.example.com/', 'https://acme.wixsite.com/']) {
    assert.match(genericAssetReason({ ...candidate, source_page }), /Wix default favicon/);
  }
  assert.match(genericAssetReason({ ...candidate, source_page: 'https://www.wix.com/' }, 'Acme'), /Wix default favicon/);
  const wordpress = await internals.validateCandidateBytes({ source: 'html-icon',
    url: 'https://wordpress.org/favicon.png', source_page: 'https://wordpress.org/' },
  await readFile(fixture('wordpress-80.png')));
  assert.ok(rankCandidates([wordpress]).assets.icon, 'the exact-byte catalog must preserve the same owner exception');
});

test('does not confuse a different monochrome mark with Wix', async () => {
  const bar = await sharp({ create: { width: 64, height: 64, channels: 4, background: 'white' } })
    .composite([{ input: Buffer.from('<svg><rect x="8" y="27" width="48" height="10"/></svg>') }]).png().toBuffer();
  assert.equal(matchGenericFingerprint((await measureTinyImageSuitability(bar)).pixel_fingerprint), null);
});

test('validated bytes carry the visual diagnostic into ranking', async () => {
  const bytes = await readFile(fixture('wordpress-32.webp'));
  const candidate = await internals.validateCandidateBytes({ source: 'html-icon', url: 'https://acme.test/favicon.webp', evidence: {} }, bytes, { contentType: 'image/webp' });
  assert.equal(candidate.observed.generic_asset.family, 'wordpress');
  await internals.attachTinySuitability([candidate]);
  const ranked = rankCandidates([candidate], { companyName: 'Acme' });
  assert.equal(candidate.observed.generic_asset.family, 'wordpress');
  assert.match(ranked.candidates[0].score_reasons.join(' '), /normalized-pixel-fingerprint/);
  assert.deepEqual(ranked.candidates[0].predicted_roles, []);
});

test('pixel fingerprints reject malformed diagnostic records without throwing', () => {
  for (const fingerprint of [null, {}, { hash: 'invalid', raster: 'bad', color: [] },
    { hash: '0000000000000000', raster: {}, color: [0, 0, 0] }]) {
    assert.equal(matchGenericFingerprint(fingerprint), null);
  }
});

test('mirrored platform pixels are rejected for DOM logos while genuine owners remain eligible', async () => {
  for (const [filename, owner] of [['wix-64.webp', 'Wix'], ['wordpress-32.webp', 'WordPress']]) {
    const candidate = await internals.validateCandidateBytes({
      source: 'dom-img', url: 'https://example.test/logo.webp',
      evidence: { dom_region: 'header', positive_token: true, home_linked: true },
    }, await readFile(fixture(filename)));
    assert.equal(rankCandidates([candidate], { companyName: 'Acme' }).assets.icon, null);
    assert.ok(rankCandidates([candidate], { companyName: owner }).assets.icon);
  }
});
