// Explicit offline benchmark: download the pinned candidate separately, never during tests.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createPredictor, predictOverlappingCrops } from '../../src/background-removal-inference.mjs';
import { removeLocalBackground } from '../../src/background-removal.mjs';

const cache = join(homedir(), '.cache/logo-yoink/background-removal');
const name = process.env.QA_VARIANT || 'birefnet-512';
const size = Number(process.env.QA_SIZE || 512);
const tiled = process.env.QA_TILED === '1';
const trim = process.env.QA_TRIM === '1';
const tileCount = Number(process.env.QA_TILE_COUNT || 2);
const out = join(cache, 'experiments', name + (trim ? '-trim' : '') + (tiled ? '-tiled' : '') + '-performance');
await mkdir(out, { recursive: true });
const root = 'test/fixtures/background-removal';
const corpus = JSON.parse(await readFile(join(root, 'manifest.json'))).map(item => ({ ...item, root }));
const freshRoot = 'test/fixtures/background-removal-independent';
const fresh = JSON.parse(await readFile(join(freshRoot, 'results.json'))).map(item => ({ ...item, id: 'fresh-' + item.name, root: freshRoot, split: 'fresh' }));
const filter = process.env.QA_ONLY?.split(',');
let peakMiB = process.memoryUsage().rss / 1024 ** 2;
const sampler = setInterval(() => { peakMiB = Math.max(peakMiB, process.memoryUsage().rss / 1024 ** 2); }, 20);
const started = performance.now();
const predict = await createPredictor({ modelPath: join(cache, 'experiments', name + '.onnx'), runtimeDirectory: join(cache, 'runtime'), architecture: 'birefnet', size });
const initMs = performance.now() - started;
async function predictCandidate(bytes) {
  if (tiled && tileCount === 2 && !trim) return predictOverlappingCrops(bytes, predict);
  const { width, height } = await sharp(bytes).metadata();
  if (trim) {
    const data = await sharp(bytes).removeAlpha().toColourspace('srgb').raw().toBuffer();
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 3;
      if (data[p] !== data[0] || data[p + 1] !== data[1] || data[p + 2] !== data[2]) {
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    if (right >= left) {
      const margin = Math.max(8, Math.ceil(Math.max(right - left + 1, bottom - top + 1) * 0.1));
      left = Math.max(0, left - margin); top = Math.max(0, top - margin);
      right = Math.min(width - 1, right + margin); bottom = Math.min(height - 1, bottom + margin);
      const region = { left, top, width: right - left + 1, height: bottom - top + 1 };
      const prediction = await predict(await sharp(bytes).extract(region).png().toBuffer());
      const mask = Buffer.alloc(width * height);
      for (let y = 0; y < region.height; y++) prediction.mask.copy(mask, (y + top) * width + left, y * region.width, (y + 1) * region.width);
      return { mask, width, height };
    }
  }
  if (!tiled || Math.max(width / height, height / width) < 2.5) return predict(bytes);
  const horizontal = width >= height;
  const long = horizontal ? width : height;
  const cropLength = Math.ceil(long * (tileCount === 3 ? 0.5 : 0.6));
  const mask = Buffer.alloc(width * height);
  const offsets = tileCount === 3 ? [0, Math.floor((long - cropLength) / 2), long - cropLength] : [0, long - cropLength];
  for (const offset of offsets) {
    const region = horizontal ? { left: offset, top: 0, width: cropLength, height } : { left: 0, top: offset, width, height: cropLength };
    const crop = await sharp(bytes).extract(region).png().toBuffer();
    const prediction = await predict(crop);
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
      const p = (y + region.top) * width + x + region.left;
      mask[p] = Math.max(mask[p], prediction.mask[y * region.width + x]);
    }
  }
  return { mask, width, height };
}
const rows = [];
try {
  for (const item of [...corpus, ...fresh].filter(item => !filter || filter.includes(item.id))) {
    const bytes = await readFile(join(item.root, item.file));
    const start = performance.now();
    const result = await removeLocalBackground(bytes, { client: { predict: predictCandidate } });
    const ms = performance.now() - start;
    if (!result.applied && !bytes.equals(result.bytes)) throw new Error('Original changed: ' + item.id);
    const metadata = await sharp(bytes).metadata();
    const outputMetadata = await sharp(result.bytes).metadata();
    if (metadata.width !== outputMetadata.width || metadata.height !== outputMetadata.height) throw new Error('Dimensions changed: ' + item.id);
    let metrics = null;
    if (result.applied && item.truth) {
      const truth = await sharp(join(item.root, item.truth)).ensureAlpha().raw().toBuffer();
      const rgba = await sharp(result.bytes).ensureAlpha().raw().toBuffer();
      let lost = 0, fg = 0, bg = 0, remaining = 0, edge = 0, edgeError = 0, composite = 0;
      for (let p = 0; p < rgba.length; p += 4) {
        const a = rgba[p + 3] / 255, t = truth[p + 3] / 255;
        if (t >= 250 / 255) { fg++; lost += 1 - a; }
        if (t === 0) { bg++; remaining += a; }
        if (t > 0 && t < 1) { edge++; edgeError += Math.abs(a - t); }
        for (let c = 0; c < 3; c++) composite += Math.abs(rgba[p + c] * a - truth[p + c] * t) / 255;
      }
      metrics = { foregroundLoss: lost / fg, remainingBackground: remaining / bg, edgeError: edgeError / edge, blackCompositeError: composite / (rgba.length / 4 * 3) };
    }
    await writeFile(join(out, item.id + '.png'), result.bytes);
    rows.push({ id: item.id, split: item.split, applied: result.applied, reason: result.reason ?? null, ms, rssMiB: process.memoryUsage().rss / 1024 ** 2, metrics });
    console.log(JSON.stringify(rows.at(-1)));
    await writeFile(join(out, 'results.json'), JSON.stringify({ name, size, tiled, tileCount, trim, initMs, peakMiB, osPeakMiB: process.resourceUsage().maxRSS / 1024, rows }, null, 2));
  }
} finally { clearInterval(sampler); await predict.close(); }
