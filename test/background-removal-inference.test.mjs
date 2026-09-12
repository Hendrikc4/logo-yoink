import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { predictOverlappingCrops } from '../src/background-removal-inference.mjs';

test('overlapping inference preserves coordinates in both orientations and stays sequential', async () => {
  for (const [width, height] of [[101, 20], [20, 101]]) {
    const bytes = await sharp({ create: { width, height, channels: 3, background: '#fff' } }).png().toBuffer();
    let active = 0, calls = 0;
    const result = await predictOverlappingCrops(bytes, async crop => {
      assert.equal(active++, 0, 'native model operations cannot overlap');
      const dimensions = await sharp(crop).metadata();
      assert.equal(Math.max(dimensions.width, dimensions.height), 61);
      const alpha = ++calls === 1 ? 100 : 220;
      await new Promise(resolve => setImmediate(resolve));
      active--;
      return { mask: Buffer.alloc(dimensions.width * dimensions.height, alpha) };
    });
    assert.equal(calls, 2);
    assert.equal(result.width, width); assert.equal(result.height, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const longCoordinate = width > height ? x : y;
      assert.equal(result.mask[y * width + x], longCoordinate < 40 ? 100 : 220);
    }
  }
});

test('compact logos use one unchanged input view', async () => {
  const bytes = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#fff' } }).png().toBuffer();
  let calls = 0;
  const expected = { mask: Buffer.alloc(48 * 32, 125), width: 48, height: 32 };
  assert.equal(await predictOverlappingCrops(bytes, async input => { calls++; assert.equal(input, bytes); return expected; }), expected);
  assert.equal(calls, 1);
});

test('malformed crop predictions fail safely instead of assembling a partial mask', async () => {
  const bytes = await sharp({ create: { width: 100, height: 20, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(predictOverlappingCrops(bytes, async () => ({ mask: Buffer.alloc(1) })), { code: 'unsafe-mask' });
});
