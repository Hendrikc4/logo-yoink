import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptBrandResults, additionalAssetFamilies, brandRoleLabel, describeVariant } from '../public/result-adapter.js';

test('homepage adapter presents icon and wordmark without a separate favicon concept', () => {
  const icon = { family_id: 'family-icon', dataUrl: 'data:image/png;base64,icon', format: 'png', width: 128, height: 128 };
  const legacyIcon = { family_id: 'family-icon', dataUrl: 'data:image/png;base64,legacy-icon', format: 'png', width: 64, height: 64 };
  const favicon = { family_id: 'family-icon', dataUrl: 'data:image/png;base64,favicon', format: 'png', width: 32, height: 32 };
  const wide = { family_id: 'family-wide', dataUrl: 'data:image/svg+xml;base64,wide', format: 'svg', width: 320, height: 80 };
  const legacyWide = { family_id: 'family-wide', dataUrl: 'data:image/svg+xml;base64,legacy-wide', format: 'svg', width: 240, height: 60 };
  const payload = {
    assets: { icon, logo: wide },
    selectedByRole: { icon: legacyIcon, wide: legacyWide, favicon },
    candidates: [icon, favicon, wide],
    assetFamilies: [
      { id: 'family-icon', candidateIndexes: [0, 1] },
      { id: 'family-wide', candidateIndexes: [2] },
    ],
  };

  const assets = adaptBrandResults(payload);
  assert.deepEqual(assets.map(asset => asset.key), ['icon', 'logo']);
  assert.deepEqual(assets.map(asset => asset.label), ['Icon', 'Wordmark']);
  assert.deepEqual(assets.map(asset => asset.selected), [icon, wide]);
  assert.deepEqual(assets[0].variants, [icon, favicon]);
  assert.equal(brandRoleLabel('favicon'), 'icon');
});

test('homepage adapter falls back to legacy role selections', () => {
  const icon = { dataUrl: 'data:image/png;base64,icon' };
  const wide = { dataUrl: 'data:image/svg+xml;base64,wide' };
  const assets = adaptBrandResults({ selectedByRole: { icon, wide }, candidates: [], assetFamilies: [] });
  assert.deepEqual(assets.map(asset => asset.selected), [icon, wide]);
});

test('homepage adapter exposes current and future theme/surface variant metadata', () => {
  assert.deepEqual(describeVariant({ evidence: { theme: 'dark' }, transparent: true }), ['For dark', 'Transparent']);
  assert.deepEqual(describeVariant({ variant: { theme: 'dark', background: 'transparent' } }), ['For dark', 'Transparent']);
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

test('homepage uses canonical role variants and reserves More assets for unselected high-confidence families', () => {
  const selected = { family_id: 'family-selected', dataUrl: 'data:selected', variant: { theme: 'light', color: 'black', background: 'transparent' }, confidence_band: 'high' };
  const deliveryTwin = { family_id: 'family-selected', dataUrl: 'data:twin', confidence_band: 'high' };
  const reverse = { family_id: 'family-reverse', dataUrl: 'data:reverse', variant: { theme: 'dark', color: 'white', background: 'transparent' }, confidence_band: 'high' };
  const other = { family_id: 'family-other', dataUrl: 'data:other', confidence_band: 'high', predicted_roles: ['favicon'] };
  const uncertain = { family_id: 'family-uncertain', dataUrl: 'data:uncertain', confidence_band: 'medium' };
  const payload = {
    assets: { icon: selected, logo: null },
    assetVariants: { icon: [selected, reverse], logo: [] },
    candidates: [selected, deliveryTwin, reverse, other, uncertain],
    assetFamilies: [
      { id: 'family-selected', candidateIndexes: [0, 1], representativeIndex: 0 },
      { id: 'family-reverse', candidateIndexes: [2], representativeIndex: 2 },
      { id: 'family-other', candidateIndexes: [3], representativeIndex: 3 },
      { id: 'family-uncertain', candidateIndexes: [4], representativeIndex: 4 },
    ],
  };

  assert.deepEqual(adaptBrandResults(payload)[0].variants, [selected, reverse]);
  assert.deepEqual(additionalAssetFamilies(payload).map(family => family.id), ['family-other']);
});
