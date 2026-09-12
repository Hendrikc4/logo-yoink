import test from 'node:test';
import assert from 'node:assert/strict';
import { assessMask } from '../src/background-removal-safety.mjs';

function fixture(dotPixels, preserveDot) {
  const width = 40, height = 24;
  const data = Buffer.alloc(width * height * 4, 255);
  const mask = Buffer.alloc(width * height);
  const paint = (x, y, alpha) => {
    const pixel = y * width + x;
    data.set([20, 60, 140, 255], pixel * 4);
    mask[pixel] = alpha;
  };
  for (let y = 5; y < 19; y++) for (let x = 5; x < 25; x++) paint(x, y, 255);
  for (let x = 31; x < 31 + dotPixels; x++) paint(x, 8, preserveDot ? 255 : 0);
  return { data, mask, width, height };
}

test('minor alpha variation is tolerated, but broad fading and missing structure are rejected', () => {
  for (const [alpha, expected] of [[250, null], [230, 'foreground-loss'], [0, 'foreground-loss']]) {
    const { data, mask, width, height } = fixture(3, true);
    for (let y = 5; y < 19; y++) for (let x = 5; x < 25; x++) mask[y * width + x] = alpha;
    assert.equal(assessMask(data, mask, width, height), expected);
  }
});

test('isolated raster specks on large artwork do not hide a missing meaningful dot', () => {
  const width = 128, height = 64, data = Buffer.alloc(width * height * 4, 255), mask = Buffer.alloc(width * height);
  for (let y = 8; y < 56; y++) for (let x = 8; x < 100; x++) {
    data.set([20, 60, 140, 255], (y * width + x) * 4);
    mask[y * width + x] = 255;
  }
  for (const size of [1, 2, 3]) {
    data.set([20, 60, 140, 255], (12 * width + 110 + size) * 4);
    assert.equal(assessMask(data, mask, width, height), size < 3 ? null : 'foreground-component-loss');
  }
});

for (const dotPixels of [1, 2, 3]) {
  test(`rejects erasure of a detached ${dotPixels}-pixel brand detail`, () => {
    const { data, mask, width, height } = fixture(dotPixels, false);
    assert.equal(assessMask(data, mask, width, height), 'foreground-component-loss');
  });
  test(`accepts a preserved detached ${dotPixels}-pixel brand detail`, () => {
    const { data, mask, width, height } = fixture(dotPixels, true);
    assert.equal(assessMask(data, mask, width, height), null);
  });
}
