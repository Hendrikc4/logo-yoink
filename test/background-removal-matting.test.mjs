import test from 'node:test';
import assert from 'node:assert/strict';
import { matteEdges } from '../src/background-removal-matting.mjs';

function fixture() {
  const width = 32, height = 24, data = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) data.set([255, 255, 255, 0], pixel * 4);
  const paint = (x, y, rgb, alpha) => data.set([...rgb, alpha], (y * width + x) * 4);
  const blue = [30, 80, 190];
  for (let y = 7; y <= 16; y++) for (let x = 8; x <= 18; x++) paint(x, y, blue, 255);
  for (let y = 8; y <= 15; y++) {
    paint(7, y, blue.map(value => Math.round(value * 0.5 + 255 * 0.5)), 210);
    paint(6, y, [255, 255, 255], 40);
  }
  return { data, width, height, paint, blue };
}

test('local matting removes pale edge contamination on a black composite', () => {
  const { data, width, height, blue } = fixture();
  const before = Buffer.from(data);
  const result = matteEdges(data, width, height);
  const output = result.data;
  assert.equal(result.reason, null);
  const edge = (10 * width + 7) * 4;
  assert.ok(Math.abs(output[edge + 3] - 128) <= 1);
  for (let channel = 0; channel < 3; channel++) {
    const composited = output[edge + channel] * output[edge + 3] / 255;
    assert.ok(Math.abs(composited - blue[channel] * 0.5) <= 1);
  }
  assert.equal(output[(10 * width + 6) * 4 + 3], 0);
  assert.deepEqual(data, before, 'input mask and RGB must not be mutated');
});

test('intentional white interior detail stays opaque', () => {
  const { data, width, height, paint } = fixture();
  for (let y = 10; y <= 12; y++) for (let x = 12; x <= 14; x++) paint(x, y, [255, 255, 255], 255);
  const result = matteEdges(data, width, height);
  assert.equal(result.reason, null);
  for (let y = 10; y <= 12; y++) for (let x = 12; x <= 14; x++) {
    assert.deepEqual(result.data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), Buffer.from([255, 255, 255, 255]));
  }
});

test('a disconnected brand dot remains fully opaque', () => {
  const { data, width, height, paint, blue } = fixture();
  for (let y = 8; y <= 12; y++) for (let x = 25; x <= 29; x++) paint(x, y, blue, 255);
  const result = matteEdges(data, width, height);
  assert.equal(result.reason, null);
  for (let y = 8; y <= 12; y++) for (let x = 25; x <= 29; x++) assert.equal(result.data[(y * width + x) * 4 + 3], 255);
});

test('a crisp opaque thin stroke is accepted without unnecessary color corrections', async () => {
  const { default: sharp } = await import('sharp');
  const { removeLocalBackground } = await import('../src/background-removal.mjs');
  const width = 32, height = 24, rgba = Buffer.alloc(width * height * 4, 255), mask = Buffer.alloc(width * height);
  for (let y = 5; y < 19; y++) {
    rgba.set([30, 80, 190, 255], (y * width + 15) * 4);
    mask[y * width + 15] = 255;
  }
  const bytes = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const result = await removeLocalBackground(bytes, { client: { predict: async () => ({ mask, width, height }) } });
  assert.equal(result.applied, true);
  const output = await sharp(result.bytes).ensureAlpha().raw().toBuffer();
  for (let pixel = 0; pixel < mask.length; pixel++) {
    assert.equal(output[pixel * 4 + 3], mask[pixel]);
    if (mask[pixel]) assert.deepEqual(output.subarray(pixel * 4, pixel * 4 + 3), Buffer.from([30, 80, 190]));
  }
});

test('broad unresolved soft edges remain rejected without guessed recoloring', () => {
  const width = 32, height = 24, data = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) data.set([255, 255, 255, 0], pixel * 4);
  for (let y = 3; y < 21; y++) data.set([140, 170, 220, 128], (y * width + 15) * 4);
  const result = matteEdges(data, width, height);
  assert.equal(result.reason, 'edge-uncertain');
  assert.deepEqual(result.data, data);
});

test('opaque patches in confirmed background still count as unresolved residue', () => {
  const width = 48, height = 32, data = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) data.set([255, 255, 255, 0], pixel * 4);
  for (let y = 8; y < 24; y++) for (let x = 30; x < 44; x++) data[(y * width + x) * 4 + 3] = 255;
  const result = matteEdges(data, width, height);
  assert.equal(result.reason, 'edge-uncertain');
  assert.ok(result.unresolvedWeight >= 224);
  assert.deepEqual(result.data, data);
});

test('a visible accumulation of pale background residue fails the separate background budget', () => {
  const { data, width, height, paint } = fixture();
  for (let y = 8; y < 12; y++) for (let x = 25; x < 29; x++) paint(x, y, [255, 255, 255], 128);
  const result = matteEdges(data, width, height);
  assert.ok(result.unresolvedWeight <= Math.max(8, result.edgeCandidates * 0.2), 'the general mixed-edge allowance alone would pass');
  assert.ok(result.unresolvedBackgroundWeight > Math.max(2, result.edgeCandidates * 0.05));
  assert.equal(result.reason, 'edge-uncertain');
});

test('an isolated faint background speck does not reject otherwise clean edges', () => {
  const { data, width, height, paint } = fixture();
  paint(27, 10, [255, 255, 255], 128);
  const result = matteEdges(data, width, height);
  assert.equal(result.reason, null);
  assert.ok(result.unresolvedBackgroundWeight < 1);
});
