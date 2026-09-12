import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import hostedHandler from '../api/extract.mjs';
import { createDemoExtractionService } from '../src/demo/extraction-service.mjs';
import { processAsset, processSelectedAssets } from '../src/post-process.mjs';
import { assessMask } from '../src/background-removal-safety.mjs';

function request(body) {
  const stream = Readable.from([Buffer.from(JSON.stringify({ website: 'example.com', ...body }))]);
  stream.headers = { 'content-type': 'application/json' };
  stream.method = 'POST';
  stream.socket = { remoteAddress: '203.0.113.77', encrypted: false };
  return stream;
}

for (const detail of ['weak-edge', 'pale-dot']) {
  test(`final mask validation ${detail === 'weak-edge' ? 'accepts an edge restored by matting' : 'rejects a detail damaged by matting'}`, async () => {
    const width = 32, height = 24, data = Buffer.alloc(width * height * 4, 255);
    const mask = Buffer.alloc(width * height), blue = [30, 80, 190];
    for (let y = 7; y <= 16; y++) for (let x = 8; x <= 18; x++) {
      const pixel = y * width + x;
      data.set([...blue, 255], pixel * 4);
      mask[pixel] = detail === 'weak-edge' && x === 9 ? 180 : 255;
    }
    if (detail === 'pale-dot') for (let y = 9; y <= 11; y++) {
      const pixel = y * width + 5;
      data.set([...blue.map(value => Math.round(value * 0.4 + 255 * 0.6)), 255], pixel * 4);
      mask[pixel] = 255;
    }
    assert.equal(assessMask(data, mask, width, height), detail === 'weak-edge' ? 'foreground-loss' : null);
    const bytes = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const { removeLocalBackground } = await import('../src/background-removal.mjs');
    const result = await removeLocalBackground(bytes, { client: { predict: async () => ({ mask, width, height }) } });
    if (detail === 'weak-edge') {
      assert.equal(result.applied, true);
      const output = await sharp(result.bytes).ensureAlpha().raw().toBuffer();
      for (let y = 7; y <= 16; y++) for (let x = 8; x <= 18; x++)
        assert.deepEqual(output.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), Buffer.from([...blue, 255]));
    } else {
      assert.equal(result.applied, false);
      assert.equal(result.reason, 'foreground-component-loss');
      assert.equal(result.bytes, bytes);
    }
  });
}

async function raster(background = '#276bffff') {
  const bytes = await sharp({ create: { width: 48, height: 24, channels: 4, background } }).png().toBuffer();
  return { resolvedUrl: 'https://example.com/logo.png', format: 'png', width: 48, height: 24,
    scalable: false, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
}

test('the deployed API rejects model processing before website extraction', async () => {
  let status;
  let payload;
  const response = {
    setHeader() {},
    status(value) { status = value; return this; },
    json(value) { payload = value; return this; },
  };
  await hostedHandler(request({ removeBackground: true }), response);
  assert.equal(status, 400);
  assert.match(payload.error, /local|background removal/i);
});

test('local HTTP requests explicitly enable removal and keep ordinary requests disabled', async () => {
  const calls = [];
  const service = createDemoExtractionService({ environment: {}, allowBackgroundRemoval: true,
    extractionOptions: () => ({}), extract: async (_url, options) => { calls.push(options); return {}; } });
  assert.equal((await service.handle(request({ removeBackground: true, upscale: 2 }))).status, 200);
  assert.equal(calls[0].removeBackground, true);
  assert.equal(calls[0].upscale, 2);
  assert.equal((await service.handle(request({}))).status, 200);
  assert.notEqual(calls[1].removeBackground, true);
});

test('disabled post-processing preserves originals and does not decode raster input', async () => {
  const original = { format: 'png', dataUrl: 'intentionally-invalid-image' };
  assert.deepEqual(await processAsset(original), { original, enhanced: null, transformations: [] });
  assert.deepEqual(await processAsset(original, { removeBackground: false }), { original, enhanced: null, transformations: [] });
});

test('existing transparency skips model removal and preserves source bytes', async () => {
  const original = await raster('#276bff80');
  const before = structuredClone(original);
  const result = await processAsset(original, { removeBackground: true });
  assert.equal(result.original, original);
  assert.equal(result.enhanced, null);
  assert.equal(result.transformations[0].applied, false);
  assert.equal(result.transformations[0].reason, 'already-transparent');
  assert.deepEqual(original, before);
});

test('SVG and unsupported inputs preserve source and never require model setup', async () => {
  for (const original of [
    { format: 'svg', scalable: true, dataUrl: 'intentionally-invalid-svg' },
    { format: 'ico', scalable: false, dataUrl: 'intentionally-invalid-icon' },
  ]) {
    const result = await processAsset(original, { removeBackground: true });
    assert.equal(result.original, original);
    assert.equal(result.enhanced, null);
    assert.equal(result.transformations[0].applied, false);
  }
});

test('removal is considered before upscaling and enhanced PNG retains canonical asset', async () => {
  const original = await raster('#276bff80');
  const before = structuredClone(original);
  const result = await processAsset(original, { removeBackground: true, upscale: 2 });
  assert.equal(result.original, original);
  assert.deepEqual(original, before);
  assert.deepEqual(result.transformations.map(item => item.type), ['background-removal', 'upscale']);
  assert.equal(result.transformations[0].reason, 'already-transparent');
  assert.equal(result.transformations[1].applied, true);
  assert.equal(result.enhanced.format, 'png');
  const bytes = Buffer.from(result.enhanced.dataUrl.split(',')[1], 'base64');
  const metadata = await sharp(bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height, metadata.hasAlpha], [96, 48, true]);
  assert.equal(result.enhanced.transformation.derivedFrom, original.resolvedUrl);
});

test('selected asset processing preserves absent roles and canonical object identity', async () => {
  const original = await raster('#276bff80');
  const result = await processSelectedAssets({ icon: original, logo: null }, { removeBackground: true });
  assert.equal(result.icon.original, original);
  assert.deepEqual(result.logo, { original: null, enhanced: null, transformations: [] });
});

// Execute isolated Node processes so module-loading assertions do not depend on test order.
async function isolated(code, environment = {}) {
  const { promisify } = await import('node:util');
  const { execFile } = await import('node:child_process');
  return promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], {
    cwd: new URL('..', import.meta.url), env: { ...process.env, VERCEL: '', ...environment }, timeout: 30_000,
  });
}

test('disabled processing never imports model modules or performs network requests', async () => {
  await isolated(`
    import { register } from 'node:module';
    import assert from 'node:assert/strict';
    register('data:text/javascript,' + encodeURIComponent(
      'export function resolve(specifier, context, nextResolve) {' +
      'if (/background-removal|onnxruntime/.test(specifier)) throw new Error("Unexpected model load: " + specifier);' +
      'return nextResolve(specifier, context); }'
    ));
    globalThis.fetch = () => { throw new Error('Unexpected network request'); };
    const { processAsset } = await import('./src/post-process.mjs');
    const original = { format: 'png', dataUrl: 'invalid-but-unused' };
    const result = await processAsset(original, { removeBackground: false });
    assert.equal(result.original, original);
    assert.equal(result.enhanced, null);
  `);
});

test('setup verifies downloaded model bytes, repairs corrupt cache, and then reuses offline', async () => {
  await isolated(`
    import { register } from 'node:module';
    import assert from 'node:assert/strict';
    import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { createHash } from 'node:crypto';
    const bytes = Buffer.from('fixture model weights');
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const modelSource = 'export const RUNTIME_VERSION = "1.22.0"; export const MODEL = ' + JSON.stringify({
      id: 'fixture', revision: 'fixture-revision', sha256: checksum, url: 'https://model.example.test/fixture.onnx',
    }) + ';';
    register('data:text/javascript,' + encodeURIComponent(
      'export function load(url, context, nextLoad) {' +
      'if (url.endsWith("/background-removal-manifest.mjs")) return { format: "module", shortCircuit: true, source: ' + JSON.stringify(modelSource) + ' };' +
      'return nextLoad(url, context); }'
    ));
    const directory = await mkdtemp(join(tmpdir(), 'logo-yoink-setup-test-'));
    try {
      await mkdir(join(directory, 'runtime/node_modules/onnxruntime-node'), { recursive: true });
      await writeFile(join(directory, 'runtime/node_modules/onnxruntime-node/package.json'), '{"version":"1.22.0"}');
      await writeFile(join(directory, 'runtime/node_modules/onnxruntime-node/index.js'), 'module.exports = {};');
      const { setupBackgroundRemoval } = await import('./src/background-removal-setup.mjs');
      globalThis.fetch = async () => new Response('corrupt download');
      await assert.rejects(setupBackgroundRemoval({ cacheDirectory: directory }), /checksum/i);
      assert.deepEqual(await readdir(join(directory, 'models')), []);
      await assert.rejects(readFile(join(directory, 'installation.json')), { code: 'ENOENT' });
      await writeFile(join(directory, 'models', checksum + '.onnx'), 'corrupt cached model');
      let downloads = 0;
      globalThis.fetch = async () => { downloads++; return new Response(bytes); };
      await setupBackgroundRemoval({ cacheDirectory: directory });
      assert.equal(downloads, 1);
      assert.deepEqual(await readFile(join(directory, 'models', checksum + '.onnx')), bytes);
      assert.equal(JSON.parse(await readFile(join(directory, 'installation.json'), 'utf8')).sha256, checksum);
      globalThis.fetch = () => { throw new Error('Cached setup attempted network'); };
      await setupBackgroundRemoval({ cacheDirectory: directory });
    } finally { await rm(directory, { recursive: true, force: true }); }
  `);
});

import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBackgroundRemovalClient, createInferenceWorker, removeLocalBackground } from '../src/background-removal.mjs';

test('failed mask gets one padded retry while preserving original dimensions', async () => {
  const width = 60, height = 40;
  const bytes = await sharp({ create: { width, height, channels: 3, background: 'white' } }).composite([{ input: { create: { width: 20, height: 20, channels: 3, background: '#2874e0' } }, left: 20, top: 10 }]).png().toBuffer();
  let calls = 0;
  const result = await removeLocalBackground(bytes, { client: { predict: async input => {
    const metadata = await sharp(input).metadata();
    const mask = Buffer.alloc(metadata.width * metadata.height);
    if (++calls === 2) {
      const margin = (metadata.width - width) / 2;
      assert.ok(margin > 0);
      for (let y = 10; y < 30; y++) mask.fill(255, (y + margin) * metadata.width + 20 + margin, (y + margin) * metadata.width + 40 + margin);
    }
    return { mask };
  } } });
  assert.equal(calls, 2); assert.equal(result.applied, true); assert.equal(result.attempts, 2);
  const metadata = await sharp(result.bytes).metadata();
  assert.equal(metadata.width, width); assert.equal(metadata.height, height);
});

test('failed retry is bounded and preserves source bytes', async () => {
  const bytes = await sharp({ create: { width: 40, height: 30, channels: 3, background: 'white' } }).png().toBuffer();
  let calls = 0;
  const result = await removeLocalBackground(bytes, { client: { predict: async input => { calls++; const m = await sharp(input).metadata(); return { mask: Buffer.alloc(m.width * m.height) }; } } });
  assert.equal(calls, 2); assert.equal(result.applied, false); assert.equal(result.bytes, bytes);
});
import { MODEL, RUNTIME_VERSION } from '../src/background-removal-manifest.mjs';

class FixtureWorker extends EventEmitter {
  constructor(behavior) { super(); this.behavior = behavior; this.terminated = false; }
  ref() {}
  unref() {}
  postMessage(message) { if (message.type === 'dispose') queueMicrotask(() => this.emit('message', { type: 'disposed' })); else this.behavior(this, message); }
  terminate() { this.terminated = true; return Promise.resolve(0); }
}

test('worker initialization is lazy, reused, serialized and bounded', async () => {
  const workers = [];
  const requests = [];
  const client = createBackgroundRemovalClient({ maxPending: 2, workerFactory: () => {
    const worker = new FixtureWorker((current, message) => requests.push({ current, message }));
    workers.push(worker); return worker;
  } });
  assert.equal(workers.length, 0);
  try {
    const first = client.predict(Buffer.from([1]));
    const second = client.predict(Buffer.from([2]));
    await assert.rejects(client.predict(Buffer.from([3])), { code: 'queue-full' });
    assert.equal(requests.length, 1);
    requests[0].current.emit('message', { id: requests[0].message.id, prediction: 'first' });
    assert.equal(await first, 'first');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 2);
    assert.equal(workers.length, 1);
    requests[1].current.emit('message', { id: requests[1].message.id, prediction: 'second' });
    assert.equal(await second, 'second');
  } finally { client.close(); }
  assert.equal(workers[0].terminated, true);
});

test('worker crash and timeout reject cleanly and a later operation recovers', async () => {
  for (const failure of ['crash', 'timeout']) {
    const workers = [];
    const client = createBackgroundRemovalClient({ timeoutMs: 20, workerFactory: () => {
      const index = workers.length;
      const worker = new FixtureWorker((current, { id }) => {
        if (index === 0 && failure === 'crash') queueMicrotask(() => current.emit('error', new Error('fixture crash')));
        else if (index > 0) queueMicrotask(() => current.emit('message', { id, prediction: 'recovered' }));
      });
      workers.push(worker); return worker;
    } });
    try {
      await assert.rejects(client.predict(Buffer.alloc(1)), { code: failure === 'crash' ? 'worker-failed' : 'inference-timeout' });
      assert.equal(workers[0].terminated, true);
      assert.equal(await client.predict(Buffer.alloc(1)), 'recovered');
      assert.equal(workers.length, 2);
    } finally { client.close(); }
  }
});

test('missing and corrupt installations return actionable status without loading ONNX', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logo-yoink-model-test-'));
  const client = createBackgroundRemovalClient({ cacheDirectory: directory });
  try {
    await assert.rejects(client.predict(Buffer.alloc(1)), error => error.code === 'setup-required' && /setup-background-removal/.test(error.message));
    await mkdir(join(directory, 'models'), { recursive: true });
    await writeFile(join(directory, 'installation.json'), JSON.stringify({ sha256: MODEL.sha256, runtimeVersion: RUNTIME_VERSION }));
    await writeFile(join(directory, 'models', `${MODEL.sha256}.onnx`), 'corrupt model');
    await assert.rejects(client.predict(Buffer.alloc(1)), error => error.code === 'installation-invalid' && /setup-background-removal/.test(error.message));
  } finally { client.close(); await rm(directory, { recursive: true, force: true }); }
});

test('inference failures and unsafe masks return the exact source bytes', async () => {
  const original = await raster();
  const bytes = Buffer.from(original.dataUrl.split(',')[1], 'base64');
  for (const client of [
    { predict: async () => { throw Object.assign(new Error('fixture failure'), { code: 'worker-failed' }); } },
    { predict: async () => ({ mask: Buffer.alloc(48 * 24) }) },
    { predict: async () => ({ mask: Buffer.alloc(48 * 24, 255) }) },
    { predict: async () => ({ mask: Buffer.alloc(12) }) },
  ]) {
    const result = await removeLocalBackground(bytes, { client });
    assert.equal(result.applied, false);
    assert.equal(result.bytes, bytes);
    assert.match(result.reason, /worker-failed|unsafe-mask/);
    assert.ok(result.message);
  }
});

test('a valid local mask preserves all source RGB channels and image dimensions', async () => {
  const bytes = await sharp({ create: { width: 48, height: 24, channels: 4, background: 'white' } })
    .composite([{ input: { create: { width: 24, height: 12, channels: 4, background: '#276bff' } }, left: 12, top: 6 }]).png().toBuffer();
  const source = await sharp(bytes).raw().toBuffer();
  const mask = Buffer.alloc(48 * 24);
  for (let y = 6; y < 18; y++) mask.fill(255, y * 48 + 12, y * 48 + 36);
  const result = await removeLocalBackground(bytes, { client: { predict: async () => ({ mask }) } });
  assert.equal(result.applied, true);
  const { data, info } = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height, info.channels], [48, 24, 4]);
  for (let pixel = 0; pixel < mask.length; pixel++) {
    assert.deepEqual(data.subarray(pixel * 4, pixel * 4 + 3), source.subarray(pixel * 4, pixel * 4 + 3));
    assert.equal(data[pixel * 4 + 3], mask[pixel]);
  }
});

test('flat reconstruction restores a detached brand dot missed by the model', async () => {
  const bytes = await sharp({ create: { width: 100, height: 60, channels: 4, background: 'white' } }).composite([
    { input: { create: { width: 60, height: 40, channels: 4, background: '#276bff' } }, left: 10, top: 10 },
    { input: { create: { width: 2, height: 2, channels: 4, background: '#276bff' } }, left: 80, top: 28 },
  ]).png().toBuffer();
  const mask = Buffer.alloc(100 * 60);
  for (let y = 10; y < 50; y++) mask.fill(255, y * 100 + 10, y * 100 + 70);
  const result = await removeLocalBackground(bytes, { client: { predict: async () => ({ mask }) } });
  assert.equal(result.applied, true);
  const output = await sharp(result.bytes).ensureAlpha().raw().toBuffer();
  for (let y = 28; y < 30; y++) for (let x = 80; x < 82; x++) assert.equal(output[(y * 100 + x) * 4 + 3], 255);
  assert.equal(output[3], 0);
});

test('corrupt raster data cannot abort extraction when optional processing is enabled', async () => {
  const original = { format: 'png', dataUrl: 'data:image/png;base64,Y29ycnVwdA==' };
  for (const options of [{ removeBackground: true }, { removeBackground: true, upscale: 2 }]) {
    const result = await processAsset(original, options);
    assert.equal(result.original, original);
    assert.equal(result.enhanced, null);
    assert.ok(result.transformations.length > 0);
    assert.ok(result.transformations.every(item => item.applied === false));
  }
});

test('hosted adapter operates with all local model modules absent', async () => {
  await isolated(`
    import { register } from 'node:module';
    import assert from 'node:assert/strict';
    import { Readable } from 'node:stream';
    register('data:text/javascript,' + encodeURIComponent(
      'export function resolve(specifier, context, nextResolve) {' +
      'if (/background-removal|onnxruntime/.test(specifier)) throw new Error("Local modules absent from deployment");' +
      'return nextResolve(specifier, context); }'
    ));
    const { default: handler } = await import('./api/extract.mjs');
    const request = Readable.from([Buffer.from(JSON.stringify({ website: 'example.com', removeBackground: true }))]);
    request.method = 'POST'; request.headers = { 'content-type': 'application/json' };
    request.socket = { remoteAddress: '203.0.113.88' };
    let status, payload;
    const response = { setHeader() {}, status(value) { status = value; return this; }, json(value) { payload = value; } };
    await handler(request, response);
    assert.equal(status, 400);
    assert.match(payload.error, /local|background removal/i);
  `, { VERCEL: '1' });
});

test('CLI downloads the selected enhanced PNG and never substitutes an unrelated processed icon', async () => {
  for (const selection of ['logo', 'unrelated']) {
    await isolated(`
      import { register } from 'node:module';
      import assert from 'node:assert/strict';
      import { mkdtemp, readFile, rm } from 'node:fs/promises';
      import { tmpdir } from 'node:os';
      import { join } from 'node:path';
      const source = [
        'export async function yoink() {',
        'const logo = { resolvedUrl: "https://example.com/logo.jpg", format: "jpg", dataUrl: "data:image/jpeg;base64,b3JpZ2luYWw=" };',
        'const icon = { resolvedUrl: "https://example.com/icon.jpg", format: "jpg", dataUrl: "data:image/jpeg;base64,aWNvbg==" };',
        'const enhanced = { resolvedUrl: "https://example.com/logo.jpg#logo-yoink-enhanced", format: "png", transformation: {}, dataUrl: "data:image/png;base64,ZW5oYW5jZWQ=" };',
        'const unrelated = { resolvedUrl: "https://example.com/different.jpg", format: "jpg", dataUrl: "data:image/jpeg;base64,dW5yZWxhdGVk" };',
        'return { candidates: [], assets: { logo, icon }, selectedByRole: {}, selected: ${selection === 'logo' ? 'logo' : 'unrelated'}, processedAssets: { logo: { original: logo, enhanced }, icon: { original: icon, enhanced: { ...enhanced, dataUrl: "data:image/png;base64,V1JPTkc=" } } } }; }',
      ].join('');
      register('data:text/javascript,' + encodeURIComponent(
        'export function load(url, context, nextLoad) {' +
        'if (url.endsWith("/src/index.mjs")) return { format: "module", shortCircuit: true, source: ' + JSON.stringify(source) + ' };' +
        'return nextLoad(url, context); }'
      ));
      const directory = await mkdtemp(join(tmpdir(), 'logo-yoink-cli-download-'));
      try {
        process.argv = [process.execPath, 'logo-yoink', 'example.com', '--remove-background', '--download', directory];
        await import('./src/cli.mjs');
        assert.equal(await readFile(join(directory, '${selection === 'logo' ? 'logo.png' : 'logo.jpg'}'), 'utf8'), '${selection === 'logo' ? 'enhanced' : 'unrelated'}');
      } finally { await rm(directory, { recursive: true, force: true }); }
    `);
  }
});

test('flat reconstruction clears a retained box without changing the foreground', async () => {
  const bytes = await sharp({ create: { width: 100, height: 60, channels: 4, background: 'white' } })
    .composite([{ input: { create: { width: 40, height: 20, channels: 4, background: '#276bff' } }, left: 30, top: 20 }]).png().toBuffer();
  const mask = Buffer.alloc(100 * 60);
  for (let y = 10; y < 50; y++) mask.fill(255, y * 100 + 20, y * 100 + 80);
  const result = await removeLocalBackground(bytes, { client: { predict: async () => ({ mask }) } });
  assert.equal(result.applied, true);
  const output = await sharp(result.bytes).ensureAlpha().raw().toBuffer();
  for (let y = 0; y < 60; y++) for (let x = 0; x < 100; x++) assert.equal(output[(y * 100 + x) * 4 + 3], x >= 30 && x < 70 && y >= 20 && y < 40 ? 255 : 0);
});

test('programmatic --input-type and --eval invocations start the IPC model worker', async () => {
  await isolated(`
    import assert from 'node:assert/strict';
    import { mkdtemp, rm } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { createBackgroundRemovalClient } from './src/background-removal.mjs';
    const directory = await mkdtemp(join(tmpdir(), 'logo-yoink-input-type-'));
    const client = createBackgroundRemovalClient({ cacheDirectory: directory });
    try { await assert.rejects(client.predict(Buffer.from('test')), { code: 'setup-required' }); }
    finally { client.close(); await rm(directory, { recursive: true, force: true }); }
  `);
});

test('successful removal updates enhanced transparency metadata and preserves canonical metadata', async () => {
  await isolated(`
    import { register } from 'node:module';
    import assert from 'node:assert/strict';
    import sharp from 'sharp';
    const replacement = 'data:text/javascript,' + encodeURIComponent('export async function removeLocalBackground(bytes) { return {bytes,applied:true,method:"local-onnx-cpu",model:"test-model",revision:"pinned",preset:"padded-soft"}; }');
    register('data:text/javascript,' + encodeURIComponent('export function resolve(specifier,context,nextResolve) { if(specifier==="./background-removal.mjs") return {url:' + JSON.stringify(replacement) + ',shortCircuit:true}; return nextResolve(specifier,context); }'));
    const { processAsset } = await import('./src/post-process.mjs');
    const bytes = await sharp({ create: { width: 10, height: 10, channels: 4, background: 'transparent' } }).png().toBuffer();
    const asset = { format:'png', background:'opaque', variant:{background:'opaque',color:'color'}, dataUrl:'data:image/png;base64,'+bytes.toString('base64') };
    const result = await processAsset(asset, { removeBackground:true });
    assert.equal(result.enhanced.background, 'transparent');
    assert.equal(result.enhanced.variant.background, 'transparent');
    assert.equal(result.enhanced.variant.color, 'color');
    assert.equal(asset.background, 'opaque');
    assert.equal(asset.variant.background, 'opaque');
    assert.equal(result.transformations[0].model, 'test-model');
    assert.equal(result.transformations[0].revision, 'pinned');
    assert.equal(result.transformations[0].preset, 'padded-soft');
  `);
});

test('idle workers are released after a batch and initialized again on demand', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const workers = [];
  const client = createBackgroundRemovalClient({ idleTimeoutMs: 50, workerFactory: () => {
    const worker = new FixtureWorker((current, { id }) => queueMicrotask(() => current.emit('message', { id, prediction: 'ok' })));
    workers.push(worker);
    return worker;
  } });
  try {
    await client.predict(Buffer.alloc(1));
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(49);
    assert.equal(workers[0].terminated, false);
    await client.predict(Buffer.alloc(1));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(workers.length, 1);
    t.mock.timers.tick(49);
    assert.equal(workers[0].terminated, false, 'a new request resets the idle deadline');
    t.mock.timers.tick(1);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(workers[0].terminated, true);
    await client.predict(Buffer.alloc(1));
    assert.equal(workers.length, 2);
  } finally { await client.close(); }
});

test('idle deadline cannot terminate active or queued model operations', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [];
  const worker = new FixtureWorker((current, message) => requests.push(message));
  const client = createBackgroundRemovalClient({ idleTimeoutMs: 50, workerFactory: () => worker });
  try {
    const first = client.predict(Buffer.alloc(1));
    const second = client.predict(Buffer.alloc(1));
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(100);
    assert.equal(worker.terminated, false);
    worker.emit('message', { id: requests[0].id, prediction: 'first' });
    await first;
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(100);
    assert.equal(worker.terminated, false);
    worker.emit('message', { id: requests[1].id, prediction: 'second' });
    await second;
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(50);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(worker.terminated, true);
  } finally { await client.close(); }
});

test('replacement worker waits for native teardown after idle release or failure', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const reason of ['idle', 'error', 'timeout']) {
    let finishTermination;
    const workers = [];
    const client = createBackgroundRemovalClient({ idleTimeoutMs: 50, timeoutMs: 200, workerFactory: () => {
      const index = workers.length;
      const worker = new FixtureWorker((current, { id }) => {
        if (index > 0 || reason === 'idle') queueMicrotask(() => current.emit('message', { id, prediction: 'ok' }));
        else if (reason === 'error') queueMicrotask(() => current.emit('error', new Error('fixture crash')));
      });
      if (index === 0) worker.terminate = () => new Promise(resolve => { finishTermination = resolve; });
      workers.push(worker);
      return worker;
    } });
    try {
      const first = client.predict(Buffer.alloc(1));
      if (reason === 'idle') {
        await first;
        await new Promise(resolve => setImmediate(resolve));
        t.mock.timers.tick(50);
      } else {
        const rejected = assert.rejects(first, { code: reason === 'error' ? 'worker-failed' : 'inference-timeout' });
        await new Promise(resolve => setImmediate(resolve));
        if (reason === 'timeout') t.mock.timers.tick(200);
        await rejected;
      }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(typeof finishTermination, 'function');
      const replacement = client.predict(Buffer.alloc(1));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(workers.length, 1, 'old native memory must be released before allocating another session');
      finishTermination(0);
      assert.equal(await replacement, 'ok');
      assert.equal(workers.length, 2);
    } finally { await client.close(); }
  }
});

test('one canonical asset selected for both roles is only processed once', async () => {
  await isolated(`
    import { register } from 'node:module';
    import assert from 'node:assert/strict';
    import sharp from 'sharp';
    const replacement = 'data:text/javascript,' + encodeURIComponent('export let calls = 0; export async function removeLocalBackground(bytes) { calls++; return {bytes,applied:true,method:"local-onnx-cpu"}; }');
    register('data:text/javascript,' + encodeURIComponent('export function resolve(specifier,context,nextResolve) { if(specifier==="./background-removal.mjs") return {url:' + JSON.stringify(replacement) + ',shortCircuit:true}; return nextResolve(specifier,context); }'));
    const { processSelectedAssets } = await import('./src/post-process.mjs');
    const bytes = await sharp({ create: { width: 10, height: 10, channels: 4, background: 'transparent' } }).png().toBuffer();
    const asset = { format:'png', resolvedUrl:'https://example.com/logo.png', dataUrl:'data:image/png;base64,'+bytes.toString('base64') };
    const result = await processSelectedAssets({icon:asset,logo:asset}, { removeBackground:true, upscale:2 });
    assert.equal((await import(replacement)).calls, 1);
    assert.equal(result.icon.original, asset);
    assert.equal(result.logo.original, asset);
    assert.equal(result.icon.enhanced.dataUrl, result.logo.enhanced.dataUrl);
    assert.equal(result.logo.enhanced.width, 20);
    const other = { ...asset, resolvedUrl: 'https://example.com/other.png', marker: 'other' };
    const copies = await processSelectedAssets({ icon:asset, logo:other }, { removeBackground:true });
    assert.equal((await import(replacement)).calls, 2, 'one further inference for both byte-identical objects in this request');
    assert.equal(copies.logo.original, other);
    assert.equal(copies.logo.enhanced.marker, 'other');
    assert.equal(copies.logo.enhanced.transformation.derivedFrom, other.resolvedUrl);

  `);
});

test('idle eviction requests native disposal before termination with a bounded fallback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const acknowledge of [true, false]) {
    const worker = new FixtureWorker(() => {});
    let disposeRequested = false;
    worker.postMessage = ({ id, type }) => {
      if (type === 'dispose') disposeRequested = true;
      else queueMicrotask(() => worker.emit('message', { id, prediction: 'ok' }));
    };
    const client = createBackgroundRemovalClient({ idleTimeoutMs: 50, workerFactory: () => worker });
    await client.predict(Buffer.alloc(1));
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(50);
    assert.equal(disposeRequested, true);
    assert.equal(worker.terminated, false, 'wait for native session release');
    if (acknowledge) worker.emit('message', { type: 'disposed' });
    else t.mock.timers.tick(1_000);
    await client.close();
    assert.equal(worker.terminated, true);
  }
});

test('real model child process exits after idle and restarts without retaining its address space', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logo-yoink-process-idle-'));
  const children = [];
  const client = createBackgroundRemovalClient({ cacheDirectory: directory, idleTimeoutMs: 20, workerFactory: (url, options) => {
    const child = createInferenceWorker(url, options);
    children.push(child);
    return child;
  } });
  try {
    await assert.rejects(client.predict(Buffer.alloc(1)), { code: 'setup-required' });
    assert.notEqual(children[0].pid, process.pid);
    const exited = new Promise(resolve => children[0].once('exit', resolve));
    // Keep the test process alive while the intentionally unreferenced idle timer runs.
    const deadline = setTimeout(() => {}, 5_000);
    try { await exited; } finally { clearTimeout(deadline); }
    assert.throws(() => process.kill(children[0].pid, 0), { code: 'ESRCH' });
    await assert.rejects(client.predict(Buffer.alloc(1)), { code: 'setup-required' });
    assert.equal(children.length, 2);
    assert.notEqual(children[0].pid, children[1].pid);
  } finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
});

test('model child exits when its parent IPC connection disappears', async () => {
  const child = createInferenceWorker(new URL('../src/background-removal-worker.mjs', import.meta.url), { workerData: {} });
  try {
    const disposed = new Promise(resolve => child.on('message', value => { if (value.type === 'disposed') resolve(); }));
    child.postMessage({ type: 'dispose' });
    await disposed;
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.disconnect();
    assert.equal(await exited, 0);
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  } finally { await child.terminate(); }
});

test('advanced model IPC preserves binary buffers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logo-yoink-process-buffer-'));
  const file = join(directory, 'worker.mjs');
  await writeFile(file, `process.on('message', message => { if (message.bytes) process.send({id:message.id,prediction:{mask:message.bytes}}); });`);
  const child = createInferenceWorker(file, { workerData: {} });
  try {
    const reply = new Promise(resolve => child.once('message', resolve));
    child.postMessage({ id: 1, bytes: Buffer.from([0, 128, 255]) });
    const { prediction } = await reply;
    assert.ok(Buffer.isBuffer(prediction.mask));
    assert.deepEqual(prediction.mask, Buffer.from([0, 128, 255]));
  } finally { await child.terminate(); await rm(directory, { recursive: true, force: true }); }
});

test('awaiting close alone keeps the process alive until worker shutdown completes', async () => {
  const { stdout, stderr } = await isolated(`
    import assert from 'node:assert/strict';
    import { randomUUID } from 'node:crypto';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { createBackgroundRemovalClient } from './src/background-removal.mjs';
    const client = createBackgroundRemovalClient({ cacheDirectory: join(tmpdir(), randomUUID()) });
    await assert.rejects(client.predict(Buffer.alloc(1)), { code: 'setup-required' });
    await client.close();
    console.log('shutdown completed');
  `);
  assert.match(stdout, /shutdown completed/);
  assert.equal(stderr, '');
});

test('a parent disconnect during asynchronous worker reply does not cause unhandled EPIPE', async () => {
  const { stdout, stderr } = await isolated(`
    import assert from 'node:assert/strict';
    process.connected = true;
    process.send = (message, callback) => {
      assert.equal(message.type, 'disposed');
      assert.equal(typeof callback, 'function');
      console.log('reply race simulated');
      queueMicrotask(() => callback(Object.assign(new Error('closed pipe'), { code: 'EPIPE' })));
    };
    await import('./src/background-removal-worker.mjs');
    process.emit('message', { type: 'dispose' });
  `);
  assert.match(stdout, /reply race simulated/);
  assert.equal(stderr, '');
});

test('trusted transparent sibling recovery does not import the model and preserves existing alpha', async () => {
  await isolated(`
    import { register } from 'node:module';
    import assert from 'node:assert/strict';
    import sharp from 'sharp';
    register('data:text/javascript,' + encodeURIComponent('export function resolve(specifier,context,nextResolve) { if(specifier==="./background-removal.mjs") throw new Error("model must not load"); return nextResolve(specifier,context); }'));
    const { processSelectedAssets } = await import('./src/post-process.mjs');
    const transparent = await sharp({ create: {width:20,height:20,channels:4,background:'transparent'} }).composite([{input:{create:{width:10,height:10,channels:4,background:'blue'}},left:5,top:5}]).png().toBuffer();
    const opaque = await sharp(transparent).flatten({background:'white'}).png().toBuffer();
    const asset = {format:'png',width:20,height:20,family_id:'family-1',predicted_roles:['icon'],variant:{theme:'light',color:'color',background:'opaque'},resolvedUrl:'https://example.com/logo.png',dataUrl:'data:image/png;base64,'+opaque.toString('base64')};
    const sibling = {...asset,dataUrl:'data:image/png;base64,'+transparent.toString('base64'),variant:{...asset.variant,background:'transparent'}};
    const ranked = {candidates:[asset,sibling],assetFamilies:[{id:'family-1',candidateIndexes:[0,1]}]};
    const recovered = await processSelectedAssets({icon:asset},{removeBackground:true},ranked);
    assert.equal(recovered.icon.transformations[0].method,'alternate-source');
    assert.equal(recovered.icon.original,asset);
    asset.dataUrl = sibling.dataUrl;
    const unchanged = await processSelectedAssets({icon:asset},{removeBackground:true},ranked);
    assert.equal(unchanged.icon.enhanced,null);
    assert.equal(unchanged.icon.transformations[0].reason,'already-transparent');
  `);
});
