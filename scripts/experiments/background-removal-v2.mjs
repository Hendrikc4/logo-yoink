import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createBackgroundRemovalClient, removeLocalBackground } from '../../src/background-removal.mjs';
import { MODEL } from '../../src/background-removal-manifest.mjs';
const out = 'runs/background-removal-v2';
await mkdir(out, { recursive: true });
const previous = JSON.parse(await readFile('docs/background-removal-quality/all-42-worker-results.json')).rows;
const root = 'test/fixtures/background-removal-fresh-v2';
const document = JSON.parse(await readFile(join(root, 'manifest.json')));
const fresh = (document.cases ?? document.rows ?? document).map(x => ({ ...x, id: 'v2-' + x.id, root, split: 'fresh-v2' }));
await mkdir(join(out, 'masks'), { recursive: true });
const native = createBackgroundRemovalClient();
const replay = process.argv.includes('--replay');
const client = {
  predict: async bytes => {
    const key = createHash('sha256').update(bytes).digest('hex');
    if (replay) return { ...JSON.parse(await readFile(join(out, 'masks', key + '.json'))), mask: await readFile(join(out, 'masks', key + '.bin')) };
    const result = await native.predict(bytes);
    await writeFile(join(out, 'masks', key + '.bin'), result.mask);
    await writeFile(join(out, 'masks', key + '.json'), JSON.stringify({ width: result.width, height: result.height }));
    return result;
  },
  close: () => native.close(),
};
const rows = [];
try {
  for (const item of [...previous, ...fresh]) {
    const input = await readFile(join(item.root, item.file));
    const start = performance.now();
    const result = await removeLocalBackground(input, { client });
    const ms = performance.now() - start;
    if (!result.applied && !result.bytes.equals(input)) throw new Error('Changed refused original');
    const metadata = await sharp(input).metadata(), output = await sharp(result.bytes).metadata();
    if (metadata.width !== output.width || metadata.height !== output.height) throw new Error('Dimensions changed');
    let metrics = null;
    if (result.applied && item.truth) {
      const actual = await sharp(result.bytes).ensureAlpha().raw().toBuffer();
      const truth = await sharp(join(item.root, item.truth)).ensureAlpha().raw().toBuffer();
      let fg = 0, loss = 0, bg = 0, residue = 0, black = 0;
      for (let p = 0; p < actual.length; p += 4) {
        const a = actual[p + 3] / 255, t = truth[p + 3] / 255;
        if (t >= 250 / 255) { fg++; loss += 1 - a; }
        if (!t) { bg++; residue += a; }
        for (let c = 0; c < 3; c++) black += Math.abs(a * actual[p + c] - t * truth[p + c]) / 255;
      }
      metrics = { foregroundLoss: fg ? loss / fg : null, remainingBackground: bg ? residue / bg : null, blackCompositeError: black / (actual.length / 4 * 3) };
    }
    await sharp(result.bytes).png().toFile(join(out, item.id + '-returned.png'));
    const { id, number, root, file, truth, split, kind, bg, sourceCompany, sourceWebsite } = item;
    rows.push({ id, number, root, file, truth, split, kind, bg, sourceCompany, sourceWebsite, applied: result.applied, reason: result.reason ?? null, method: result.method ?? null, attempts: result.attempts ?? 1, ms, metrics });
    await writeFile(join(out, 'results.json'), JSON.stringify({ model: MODEL, replay, rows }, null, 2));
    console.log(`${rows.length}/60 ${item.id}: ${result.applied ? result.method : result.reason} (${result.attempts ?? 1} attempts)`);
  }
} finally { await client.close(); }
