import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { internals } from '../src/extractor.mjs';
import { rankCandidates } from '../src/rank.mjs';
import { parseArgs } from '../scripts/benchmark/benchmark.mjs';
import { measureTinyImageSuitability } from '../src/tiny-image-suitability.mjs';

async function paddedLogo(width = 200, height = 200, rect = { x: 10, y: 80, width: 180, height: 40 }) {
  const mark = await sharp({ create: { width: rect.width, height: rect.height, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, left: rect.x, top: rect.y }]).png().toBuffer();
}

test('role-aware budget reserves slots and rejects weak body images', () => {
  const manifests = Array.from({ length: 15 }, (_, index) => ({ url: `https://acme.test/icon-${index}.png`, source: 'manifest', sizes: '512x512' }));
  const wordmark = { url: 'https://acme.test/wordmark.svg', source: 'dom-img', evidence: { positive_token: true, dom_region: 'header' } };
  const screenshot = { url: 'https://acme.test/app-screen.png', source: 'dom-img', evidence: { dom_region: 'body' } };
  const result = internals.selectRoleAware([...manifests, wordmark, screenshot]);
  assert.equal(result.chosen.length, 16);
  assert.ok(result.chosen.includes(wordmark));
  assert.ok(!result.chosen.includes(screenshot));
});

test('content bounding finds a wide mark inside a square canvas', async () => {
  const box = await internals.measureContentBox(await paddedLogo(), { width: 200, height: 200 });
  assert.ok(box.width / box.height > 3.8);
  assert.ok(box.width / box.height < 5.2);
});

test('content bounding rejects blank and sliver-only images', async () => {
  const blank = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 120, g: 120, b: 120, alpha: 1 } } }).png().toBuffer();
  assert.equal(await internals.measureContentBox(blank), null);
  const item = {
    url: 'https://acme.test/divider.png', source: 'schema', width: 400, height: 300,
    dataUrl: `data:image/png;base64,${(await paddedLogo(400, 300, { x: 20, y: 148, width: 360, height: 4 })).toString('base64')}`,
  };
  const stats = { boxes: 0 };
  await internals.attachContentBoxes([item], true, 'Acme', stats);
  assert.equal(item.contentBox, undefined);
});

test('content box changes only wide-role shape scoring', () => {
  const item = {
    url: 'https://acme.test/acme-logo.svg', source: 'dom-img', width: 600, height: 500,
    highResolution: true, scalable: true, bytes: 100,
    evidence: { positive_token: true, dom_region: 'header', home_linked: true },
  };
  const before = rankCandidates([item], { companyName: 'Acme' }).candidates[0];
  const after = rankCandidates([{ ...item, contentBox: { width: 580, height: 60 } }], { companyName: 'Acme' }).candidates[0];
  assert.ok(!before.predicted_roles.includes('wide'));
  assert.ok(after.predicted_roles.includes('wide'));
  assert.equal(after.role_scores.icon, before.role_scores.icon);
  assert.equal(after.role_scores.favicon, before.role_scores.favicon);
});

test('benchmark exposes both experiments as off-by-default booleans', () => {
  const enabled = parseArgs(['--cohort', 'original-100', '--role-budget', '--content-bounding-wide']);
  assert.equal(enabled.roleBudget, true);
  assert.equal(enabled.contentBoundingWide, true);
  const control = parseArgs(['--cohort', 'original-100']);
  assert.equal(control.roleBudget, undefined);
  assert.equal(control.contentBoundingWide, undefined);
});

test('tiny suitability rewards a clear occupied mark over a blank canvas', async () => {
  const mark = await sharp({ create: { width: 36, height: 36, channels: 4, background: { r: 20, g: 40, b: 220, alpha: 1 } } }).png().toBuffer();
  const image = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: mark, left: 14, top: 14 }]).png().toBuffer();
  const blank = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
  const [markScore, blankScore] = await Promise.all([measureTinyImageSuitability(image), measureTinyImageSuitability(blank)]);
  assert.ok(markScore.score > blankScore.score);
  assert.ok(markScore.foreground_occupancy > 0.1);
});

test('canonical icon rejects tiny visible content and exposes its diagnostics', async () => {
  const tiny = await paddedLogo(256, 256, { x: 120, y: 120, width: 12, height: 12 });
  const usable = await paddedLogo(256, 256, { x: 48, y: 48, width: 160, height: 160 });
  const items = [tiny, usable].map((bytes, index) => ({
    source: 'apple', url: `https://acme.test/icon-${index}.png`, width: 256, height: 256,
    highResolution: true, bytes: bytes.length, evidence: {},
  }));
  items[0].tinySuitability = await measureTinyImageSuitability(tiny);
  items[1].tinySuitability = await measureTinyImageSuitability(usable);
  const result = rankCandidates(items, { companyName: 'Acme' });
  assert.equal(result.assets.icon.url, items[1].url);
  assert.ok(result.candidates.find(item => item.url === items[0].url).icon_quality_rejections.includes('visible content box is too small'));
  assert.equal(rankCandidates([{ ...items[0], contentBox: { width: 12, height: 12 } }]).assets.icon, null,
    'a measured content box must not exempt undersized artwork from quality checks');
});

test('canonical icon abstains from a blank image, including favicon fallback', async () => {
  const blank = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
  const result = rankCandidates([{
    source: 'html-icon', url: 'https://acme.test/favicon.png', width: 64, height: 64,
    highResolution: false, bytes: blank.length, evidence: { eligible_roles: ['favicon'] },
    tinySuitability: await measureTinyImageSuitability(blank),
  }], { companyName: 'Acme' });
  assert.equal(result.assets.icon, null);
  assert.deepEqual(result.candidates[0].icon_quality_rejections, ['negligible foreground occupancy', 'visible content box is too small']);
});

test('white transparent artwork follows the requested icon surface', async () => {
  const whiteMark = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
  const bytes = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: whiteMark, left: 12, top: 12 }]).png().toBuffer();
  const candidate = {
    source: 'apple', url: 'https://acme.test/white-icon.png', width: 64, height: 64,
    highResolution: true, bytes: bytes.length, background: 'transparent', evidence: { theme: 'dark' },
    tinySuitability: await measureTinyImageSuitability(bytes),
  };
  const light = rankCandidates([candidate], { companyName: 'Acme', preferences: { icon: { theme: 'light' } } });
  const dark = rankCandidates([candidate], { companyName: 'Acme', preferences: { icon: { theme: 'dark' } } });
  assert.equal(light.assets.icon, null);
  assert.equal(dark.assets.icon.url, candidate.url);
  assert.ok(light.candidates[0].icon_quality_rejections.includes('insufficient contrast on light surface'));
  assert.ok(candidate.tinySuitability.surface_contrast.dark > 0.9);
});

test('opaque backgrounds preserve intrinsic contrast on either requested surface', async () => {
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="black"/><circle cx="32" cy="32" r="20" fill="white"/></svg>');
  const candidate = await internals.validateCandidateBytes({
    source: 'apple', url: 'https://acme.test/icon.svg', evidence: {},
  }, bytes);
  assert.equal(candidate.background, 'opaque');
  for (const theme of ['light', 'dark']) {
    assert.ok(rankCandidates([candidate], { preferences: { icon: { theme } } }).assets.icon);
  }
});

test('cropped square wordmark loses to an intact icon and exposes clipping diagnostics', async () => {
  const cropped = await paddedLogo(128, 128, { x: 0, y: 48, width: 128, height: 32 });
  const intact = await paddedLogo(128, 128, { x: 28, y: 28, width: 72, height: 72 });
  const candidate = async (bytes, name) => ({
    source: 'dom-img', url: `https://acme.test/${name}.png`, width: 128, height: 128,
    highResolution: true, bytes: bytes.length,
    evidence: { positive_token: true, home_linked: true, dom_region: 'header', alt: 'Acme' },
    tinySuitability: await measureTinyImageSuitability(bytes),
  });
  const result = rankCandidates([
    await candidate(cropped, 'acme-wordmark'),
    await candidate(intact, 'acme-icon'),
  ], { companyName: 'Acme' });
  const rejected = result.candidates.find(item => item.url.endsWith('acme-wordmark.png'));
  assert.equal(result.assets.icon.url, 'https://acme.test/acme-icon.png');
  assert.equal(rejected.tinySuitability.opposing_edge_contacts.horizontal, true);
  assert.ok(rejected.tinySuitability.edge_contact.left > 0);
  assert.ok(rejected.tinySuitability.foreground_box.aspect_ratio >= 3.5);
  assert.equal(rejected.clipping.likely_clipped, true);
  assert.deepEqual(rejected.predicted_roles, []);
});

test('full-bleed square geometry and one-edge artwork are not classified as clipped', async () => {
  const bar = await sharp({ create: { width: 128, height: 24, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
  const upright = await sharp({ create: { width: 24, height: 128, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
  const fullBleed = await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: bar, left: 0, top: 52 }, { input: upright, left: 52, top: 0 }]).png().toBuffer();
  const oneEdge = await paddedLogo(128, 128, { x: 0, y: 24, width: 80, height: 80 });
  const candidates = await Promise.all([
    ['fullbleed-apple', 'apple', fullBleed],
    ['fullbleed-manifest', 'manifest', fullBleed],
    ['one-edge', 'dom-img', oneEdge],
  ].map(async ([name, source, bytes]) => ({
    source, url: `https://acme.test/${name}.png`, width: 128, height: 128,
    highResolution: true, bytes: bytes.length,
    evidence: { positive_token: true, home_linked: true, dom_region: 'header', alt: 'Acme' },
    tinySuitability: await measureTinyImageSuitability(bytes),
  })));
  const result = rankCandidates(candidates, { companyName: 'Acme' });
  const checked = candidates.map(candidate => result.candidates.find(item => item.url === candidate.url));
  for (const full of checked.slice(0, 2)) {
    assert.equal(full.tinySuitability.opposing_edge_contacts.horizontal, true);
    assert.equal(full.tinySuitability.opposing_edge_contacts.vertical, true);
    assert.equal(full.clipping.likely_clipped, false);
    assert.ok(full.predicted_roles.includes('icon'));
  }
  const edge = checked[2];
  assert.equal(edge.tinySuitability.edge_contact.left > 0, true);
  assert.equal(edge.tinySuitability.opposing_edge_contacts.horizontal, false);
  assert.equal(edge.clipping.likely_clipped, false);
  assert.ok(result.assets.icon);
});

test('a cropped wordmark favicon cannot enter the canonical icon fallback', async () => {
  const cropped = await paddedLogo(64, 64, { x: 0, y: 22, width: 64, height: 20 });
  const intact = await paddedLogo(64, 64, { x: 10, y: 10, width: 44, height: 44 });
  const candidates = await Promise.all([
    ['brand-wordmark', cropped],
    ['brand-icon', intact],
  ].map(async ([name, bytes]) => ({
    source: 'html-icon', url: `https://acme.test/${name}.png`, width: 64, height: 64,
    bytes: bytes.length, tinySuitability: await measureTinyImageSuitability(bytes),
    evidence: { eligible_roles: ['favicon'] },
  })));
  const result = rankCandidates(candidates, { companyName: 'Acme' });
  const croppedCandidate = result.candidates.find(item => item.url.includes('wordmark'));
  assert.equal(croppedCandidate.clipping.likely_clipped, true);
  assert.deepEqual(croppedCandidate.predicted_roles, []);
  assert.equal(result.assets.icon.url, 'https://acme.test/brand-icon.png');
});

test('an elongated full-bleed geometric favicon is penalized but remains eligible', async () => {
  const bytes = await sharp(Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
      <path fill="#6d28d9" d="M0 48c12-25 28-25 48 0 20-25 36-25 48 0-12 25-28 25-48 0-20 25-36 25-48 0Z"/>
    </svg>`)).png().toBuffer();
  const result = rankCandidates([{
    source: 'html-icon', url: 'https://acme.test/app-symbol.png', width: 96, height: 96,
    bytes: bytes.length, tinySuitability: await measureTinyImageSuitability(bytes),
    evidence: { eligible_roles: ['favicon'] },
  }], { companyName: 'Acme' });
  const candidate = result.candidates[0];
  assert.equal(candidate.tinySuitability.opposing_edge_contacts.horizontal, true);
  assert.ok(candidate.clipping.measured_content_aspect_ratio >= 1.8);
  assert.equal(candidate.clipping.likely_clipped, false);
  assert.ok(candidate.score_reasons.includes('possible edge clipping (ranking only) -3'));
  assert.ok(rankCandidates([{ ...candidate, width: 16, height: 16 }]).assets.icon,
    'ambiguous edge contact must not disqualify an otherwise usable small favicon');
  assert.ok(candidate.predicted_roles.includes('favicon'));
  assert.equal(result.assets.icon.url, candidate.url);
  const large = { ...candidate, evidence: {} };
  const small = { ...large, url: 'https://acme.test/small-symbol.png', width: 32, height: 32,
    tinySuitability: { ...large.tinySuitability, opposing_edge_contacts: { horizontal: false, vertical: false } } };
  assert.equal(rankCandidates([large, small]).assets.icon.url, large.url,
    'uncertain clipping should not force a lower-resolution alternative');
});

test('explicit cropped wordmark can be detected before it becomes extremely elongated', async () => {
  const bytes = await paddedLogo(200, 200, { x: 0, y: 35, width: 200, height: 130 });
  const quality = await measureTinyImageSuitability(bytes);
  const ranked = rankCandidates([{
    source: 'dom-img', url: 'https://acme.test/acme-wordmark.png', width: 200, height: 200,
    highResolution: true, bytes: bytes.length, tinySuitability: quality,
    evidence: { positive_token: true, dom_region: 'header', home_linked: true },
  }], { companyName: 'Acme' }).candidates[0];
  assert.ok(ranked.clipping.measured_content_aspect_ratio > 1.4);
  assert.ok(ranked.clipping.measured_content_aspect_ratio < 1.8);
  assert.equal(ranked.clipping.likely_clipped, true);
});

test('an intact wide logo touching both horizontal edges is not treated as a square crop', async () => {
  const bytes = await paddedLogo(300, 100, { x: 0, y: 10, width: 300, height: 80 });
  const ranked = rankCandidates([{
    source: 'dom-img', url: 'https://acme.test/acme-wordmark.png', width: 300, height: 100,
    highResolution: true, bytes: bytes.length, tinySuitability: await measureTinyImageSuitability(bytes),
    evidence: { positive_token: true, dom_region: 'header', home_linked: true },
  }], { companyName: 'Acme' }).candidates[0];
  assert.ok(ranked.clipping.measured_content_aspect_ratio > 3);
  assert.equal(ranked.clipping.likely_clipped, false);
  assert.ok(ranked.predicted_roles.includes('wide'));
});
