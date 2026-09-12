import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processAsset, processSelectedAssets } from '../src/post-process.mjs';

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

test('background removal preserves the original when explicit setup is missing', async () => {
  const bytes = await sharp({
    create: { width: 80, height: 60, channels: 3, background: 'white' },
  }).composite([{ input: { create: { width: 40, height: 20, channels: 3, background: '#d22' } }, left: 20, top: 20 }]).png().toBuffer();
  const original = await assetFrom(bytes);
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'logo-yoink-unconfigured-'));
  const previousCache = process.env.LOGO_YOINK_MODEL_CACHE;
  process.env.LOGO_YOINK_MODEL_CACHE = cacheDirectory;
  try {
    const result = await processAsset(original, { removeBackground: true });
    assert.equal(result.original, original);
    assert.equal(result.enhanced, null);
    assert.equal(result.transformations[0].type, 'background-removal');
    assert.equal(result.transformations[0].applied, false);
    assert.equal(result.transformations[0].reason, 'setup-required');
    assert.match(result.transformations[0].message, /setup-background-removal/);
  } finally {
    if (previousCache === undefined) delete process.env.LOGO_YOINK_MODEL_CACHE;
    else process.env.LOGO_YOINK_MODEL_CACHE = previousCache;
    await rm(cacheDirectory, { recursive: true, force: true });
  }
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


test('local removal first uses only a trusted transparent same-family role/theme sibling', async () => {
  const transparent = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#00000000' } })
    .composite([{ input: { create: { width: 10, height: 10, channels: 4, background: '#2255ffff' } }, left: 5, top: 5 }]).png().toBuffer();
  const opaque = await sharp(transparent).flatten({ background: 'white' }).png().toBuffer();
  const original = { ...await assetFrom(opaque), family_id: 'family-1', predicted_roles: ['icon'], variant: { theme: 'light', color: 'color', background: 'opaque' } };
  const alternate = { ...await assetFrom(transparent), resolvedUrl: 'https://example.test/logo.png?format=png', family_id: 'family-1', predicted_roles: ['icon'], variant: { theme: 'light', color: 'color', background: 'transparent' } };
  const ranked = { candidates: [original, alternate], assetFamilies: [{ id: 'family-1', candidateIndexes: [0, 1] }] };
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'logo-yoink-alternate-'));
  const previousCache = process.env.LOGO_YOINK_MODEL_CACHE;
  process.env.LOGO_YOINK_MODEL_CACHE = cacheDirectory;
  try {
    const run = () => processSelectedAssets({ icon: original, logo: null }, { removeBackground: true, upscale: 2 }, ranked);
    const result = (await run()).icon;
    assert.equal(result.original, original);
    assert.equal(result.original.dataUrl, original.dataUrl);
    assert.equal(result.enhanced.width, 40);
    assert.equal(result.transformations[0].applied, true);
    assert.equal(result.transformations[0].method, 'alternate-source');
    assert.equal(result.transformations[0].sourceUrl, alternate.resolvedUrl);
    assert.equal(result.transformations[1].type, 'upscale');
    assert.equal(result.enhanced.transformation.derivedFrom, original.resolvedUrl);
    assert.equal(result.enhanced.background, 'transparent');
    for (const patch of [ {family_id:'other'}, {predicted_roles:['wide']}, {variant:{...alternate.variant,theme:'dark'}}, {variant:{...alternate.variant,color:'black'}}, {dataUrl:original.dataUrl} ]) {
      const bad = { ...alternate, ...patch };
      const output = await processSelectedAssets({icon:original}, {removeBackground:true}, {...ranked,candidates:[original,bad]});
      assert.equal(output.icon.enhanced, null);
    }
    const untrusted = await processSelectedAssets({icon:original}, {removeBackground:true,ranked,assetVariants:{icon:[alternate]}});
    assert.equal(untrusted.icon.enhanced, null);
    const off = await processSelectedAssets({icon:original}, {}, ranked);
    assert.equal(off.icon.enhanced, null);
    assert.deepEqual(off.icon.transformations, []);
    const previousVercel = process.env.VERCEL;
    process.env.VERCEL = '1';
    try {
      const hosted = await processSelectedAssets({icon:original}, {removeBackground:true}, ranked);
      assert.equal(hosted.icon.enhanced, null);
      assert.equal(hosted.icon.transformations[0].reason, 'local-only');
    } finally {
      if (previousVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previousVercel;
    }

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect x="5" y="5" width="10" height="10" fill="#2255ff"/></svg>');
    const vector = {...alternate,format:'svg',dataUrl:'data:image/svg+xml;base64,'+svg.toString('base64')};
    const fromVector = await processSelectedAssets({icon:original}, {removeBackground:true}, {...ranked,candidates:[original,vector]});
    assert.equal(fromVector.icon.enhanced.format,'png');
    assert.equal(fromVector.icon.enhanced.width,20);
    assert.equal(fromVector.icon.transformations[0].sourceFormat,'svg');
  } finally {
    if (previousCache === undefined) delete process.env.LOGO_YOINK_MODEL_CACHE;
    else process.env.LOGO_YOINK_MODEL_CACHE = previousCache;
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});
