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
