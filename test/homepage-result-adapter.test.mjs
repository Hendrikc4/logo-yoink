import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptBrandResults, brandRoleLabel, describeVariant } from '../public/result-adapter.js';

test('homepage adapter presents icon and wordmark without a separate favicon concept', () => {
  const icon = { family_id: 'family-icon', dataUrl: 'data:image/png;base64,icon', format: 'png', width: 128, height: 128 };
  const favicon = { family_id: 'family-icon', dataUrl: 'data:image/png;base64,favicon', format: 'png', width: 32, height: 32 };
  const wide = { family_id: 'family-wide', dataUrl: 'data:image/svg+xml;base64,wide', format: 'svg', width: 320, height: 80 };
  const payload = {
    selectedByRole: { icon, wide, favicon },
    candidates: [icon, favicon, wide],
    assetFamilies: [
      { id: 'family-icon', candidateIndexes: [0, 1] },
      { id: 'family-wide', candidateIndexes: [2] },
    ],
  };

  const assets = adaptBrandResults(payload);
  assert.deepEqual(assets.map(asset => asset.key), ['icon', 'wide']);
  assert.deepEqual(assets.map(asset => asset.label), ['Icon', 'Wordmark']);
  assert.deepEqual(assets[0].variants, [icon, favicon]);
  assert.equal(brandRoleLabel('favicon'), 'icon');
});

test('homepage adapter exposes current and future theme/surface variant metadata', () => {
  assert.deepEqual(describeVariant({ evidence: { theme: 'dark' }, transparent: true }), ['For dark', 'Transparent']);
  assert.deepEqual(describeVariant({ variant: { theme: 'light', surface: 'opaque' } }), ['For light', 'Opaque']);
  assert.deepEqual(describeVariant({ variant: { color: 'white', transparency: 'transparent' } }), ['White', 'Transparent']);

  const selected = {
    dataUrl: 'data:image/svg+xml;base64,default',
    variants: [
      { dataUrl: 'data:image/svg+xml;base64,default', variant: { theme: 'light' } },
      { dataUrl: 'data:image/svg+xml;base64,reverse', variant: { theme: 'dark' } },
    ],
  };
  const [asset] = adaptBrandResults({ selectedByRole: { icon: selected }, candidates: [], assetFamilies: [] });
  assert.equal(asset.variants.length, 2);
  assert.deepEqual(describeVariant(asset.variants[0]), ['For light']);
  assert.deepEqual(describeVariant(asset.variants[1]), ['For dark']);
});
