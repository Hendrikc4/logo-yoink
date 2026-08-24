import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { analyzeCropBuffer, candidateGate, chooseSmallestDescendant, hasPositiveLogoToken, isLocalizedHomeLink } from '../scripts/rendered-wide-audit.mjs';

test('rendered-wide evidence accepts localized home links and separated logo tokens', () => {
  assert.equal(isLocalizedHomeLink('https://example.com/de/', 'example.com'), true);
  assert.equal(isLocalizedHomeLink('https://example.com/contact', 'example.com'), false);
  assert.equal(isLocalizedHomeLink('https://other.test/', 'example.com'), false);
  assert.equal(hasPositiveLogoToken('headerLogo'), true);
  assert.equal(hasPositiveLogoToken('catalogology'), false);
});

test('rendered-wide gate enforces dimensions, shape, viewport, and identity evidence', () => {
  const instance = { instance_box: { width: 200, height: 50 }, crop_path: 'crop.png', evidence: { viewport: { width: 1000 } }, locator: { id: '', class_name: 'site-logo', anchor_href: null } };
  assert.equal(candidateGate(instance, { name: 'Acme', website: 'acme.test' }).accepted, true);
  assert.deepEqual(candidateGate({ ...instance, instance_box: { width: 900, height: 50 } }, { name: 'Acme', website: 'acme.test' }).reasons.sort(), ['ratio-out-of-range', 'viewport-width-limit', 'width-out-of-range']);
});

test('smallest descendant wins deterministically', () => {
  const record = (id, width, height, strength = {}) => ({ instance: { visual_instance_id: id, instance_box: { width, height }, locator: { class_name: id } }, gate: { evidence: { home_link: false, logo_token: false, company_dom: false, ...strength } } });
  assert.equal(chooseSmallestDescendant([record('ancestor', 300, 80), record('descendant', 120, 40)]).instance.visual_instance_id, 'descendant');
});

test('pixel audit rejects empty and edge-clipped crops but accepts an inset wordmark-like crop', async () => {
  const empty = await sharp({ create: { width: 120, height: 40, channels: 3, background: 'white' } }).png().toBuffer();
  const inset = await sharp({ create: { width: 120, height: 40, channels: 3, background: 'white' } }).composite([{ input: await sharp({ create: { width: 80, height: 16, channels: 3, background: '#1459a6' } }).png().toBuffer(), left: 20, top: 12 }]).png().toBuffer();
  const clipped = await sharp({ create: { width: 120, height: 40, channels: 3, background: 'white' } }).composite([{ input: await sharp({ create: { width: 100, height: 16, channels: 3, background: '#1459a6' } }).png().toBuffer(), left: 0, top: 12 }]).png().toBuffer();
  assert.deepEqual((await analyzeCropBuffer(empty)).reasons, ['empty-or-background-only']);
  assert.equal((await analyzeCropBuffer(inset)).accepted, true);
  assert.ok((await analyzeCropBuffer(clipped)).reasons.includes('clipped-at-edge'));
});
