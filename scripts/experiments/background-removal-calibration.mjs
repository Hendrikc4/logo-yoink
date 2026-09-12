// Diagnostic experiment only: test model-confidence calibration before safety.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { removeLocalBackground } from '../../src/background-removal.mjs';
const root = 'runs/background-removal-all-42';
const out = root + '/calibration';
await mkdir(out, { recursive: true });
const corpus = JSON.parse(await readFile(join(root, 'results.json'))).rows;
const rows = [];
for (const item of corpus) {
  const input = await readFile(join(item.root, item.file));
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mask = await readFile(join(root, item.id + '.mask'));
  const adjusted = Buffer.from(mask);
  const w = info.width, h = info.height;
  let changed = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    if (mask[p] < 128) continue;
    let supported = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const q = p + dy * w + dx;
      if (mask[q] < 128 || Math.hypot(...[0, 1, 2].map(c => data[p * 4 + c] - data[q * 4 + c])) > 8) supported = false;
    }
    if (supported) { adjusted[p] = 255; if (mask[p] !== 255) changed++; }
  }
  const result = await removeLocalBackground(input, { client: { predict: async () => ({ mask: adjusted, width: w, height: h }) } });
  await writeFile(join(out, item.id + '.png'), result.bytes);
  rows.push({ id: item.id, oldApplied: item.applied, applied: result.applied, reason: result.reason ?? null, changed });
}
await writeFile(join(out, 'results.json'), JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows, null, 2));
