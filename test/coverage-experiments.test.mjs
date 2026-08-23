import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { internals } from '../src/extractor.mjs';
import { rankCandidates } from '../src/rank.mjs';
import { parseArgs } from '../scripts/benchmark.mjs';

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
