import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { processAsset } from '../src/post-process.mjs';

async function assetFrom(bytes, format = 'png') {
  const metadata = await sharp(bytes).metadata();
  return {
    resolvedUrl: `https://example.test/logo.${format}`,
    dataUrl: `data:image/${format};base64,${bytes.toString('base64')}`,
    format,
    width: metadata.width,
    height: metadata.height,
    scalable: false,
  };
}

test('background removal keeps the original and returns a transparent enhanced PNG', async () => {
  const bytes = await sharp({
    create: { width: 80, height: 60, channels: 3, background: 'white' },
  }).composite([{ input: { create: { width: 40, height: 20, channels: 3, background: '#d22' } }, left: 20, top: 20 }]).png().toBuffer();
  const original = await assetFrom(bytes);
  const result = await processAsset(original, { removeBackground: true });
  assert.equal(result.original, original);
  assert.ok(result.enhanced);
  assert.equal(result.enhanced.format, 'png');
  assert.equal(result.transformations[0].type, 'background-removal');
  assert.equal(result.transformations[0].applied, true);
  assert.equal((await sharp(Buffer.from(result.enhanced.dataUrl.split(',')[1], 'base64')).metadata()).hasAlpha, true);
});

test('upscaling applies only below the request and preserves aspect ratio', async () => {
  const bytes = await sharp({ create: { width: 40, height: 20, channels: 4, background: '#2458ffff' } }).png().toBuffer();
  const original = await assetFrom(bytes);
  const enlarged = await processAsset(original, { upscale: { width: 200, height: 100 } });
  assert.deepEqual([enlarged.enhanced.width, enlarged.enhanced.height], [200, 100]);
  assert.equal(enlarged.transformations[0].method, 'lanczos3');
  const unchanged = await processAsset(original, { upscale: { width: 20, height: 10 } });
  assert.equal(unchanged.enhanced, null);
  assert.equal(unchanged.transformations[0].reason, 'source-meets-requested-size');
});

test('post-processing leaves vector assets unchanged', async () => {
  const vector = { resolvedUrl: 'https://example.test/logo.svg', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+', format: 'svg', scalable: true };
  const result = await processAsset(vector, { removeBackground: true, upscale: 2 });
  assert.equal(result.enhanced, null);
  assert.equal(result.transformations[0].reason, 'vector-unchanged');
});
