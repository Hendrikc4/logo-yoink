// Audit every prediction, including refused ones. Raw files are diagnostic only.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { MODEL } from '../../src/background-removal-manifest.mjs';
import { backgroundRemovalPaths } from '../../src/background-removal-paths.mjs';
import { createPredictor } from '../../src/background-removal-inference.mjs';
import { createBackgroundRemovalClient, createInferenceWorker, removeLocalBackground } from '../../src/background-removal.mjs';
import { matteEdges } from '../../src/background-removal-matting.mjs';

const out = 'runs/background-removal-all-42';
await mkdir(out, { recursive: true });
const corpus = JSON.parse(await readFile('test/fixtures/background-removal/manifest.json')).map(x => ({ ...x, root: 'test/fixtures/background-removal' }));
const fresh = JSON.parse(await readFile('test/fixtures/background-removal-independent/results.json')).map(x => ({ ...x, id: 'fresh-' + x.name, root: 'test/fixtures/background-removal-independent' }));
const replay = process.argv.includes('--replay');
const workerRun = process.argv.includes('--worker');
if (replay && workerRun) throw new Error('Choose replay or worker verification, not both.');
if (replay || workerRun) {
  const stored = JSON.parse(await readFile(join(out, 'results.json')));
  if (stored.model.sha256 !== MODEL.sha256 || stored.model.preset !== MODEL.preset || stored.rows.length !== 42) throw new Error('Cached predictions must match the current model/preset and contain all 42 cases.');
}
const paths = backgroundRemovalPaths();
const guard = 'data:text/javascript,' + encodeURIComponent(`import http from 'node:http'; import https from 'node:https'; import net from 'node:net'; import {syncBuiltinESMExports} from 'node:module'; const deny=()=>{throw new Error('Network disabled for offline inference verification')}; globalThis.fetch=deny; http.request=http.get=https.request=https.get=net.connect=net.createConnection=deny; syncBuiltinESMExports();`);
if (workerRun) await import(guard);
const client = workerRun ? createBackgroundRemovalClient({ workerFactory: (url, options) => createInferenceWorker(url, { ...options, execArgv: [...options.execArgv, '--import', guard] }) }) : null;
const predict = replay ? null : client ? Object.assign(bytes => client.predict(bytes), { close: () => client.close() }) : await createPredictor({ ...MODEL, modelPath: join(paths.modelsDirectory, MODEL.sha256 + '.onnx'), runtimeDirectory: paths.runtimeDirectory });
const rows = [];
const metrics = (rgba, truth) => {
  if (!truth) return null;
  let fg = 0, loss = 0, bg = 0, residue = 0, edge = 0, edgeError = 0, black = 0;
  for (let p = 0; p < rgba.length; p += 4) {
    const a = rgba[p + 3] / 255, t = truth[p + 3] / 255;
    if (t >= 250 / 255) { fg++; loss += 1 - a; }
    if (t === 0) { bg++; residue += a; }
    if (t > 0 && t < 1) { edge++; edgeError += Math.abs(t - a); }
    for (let c = 0; c < 3; c++) black += Math.abs(rgba[p + c] * a - truth[p + c] * t) / 255;
  }
  return { foregroundLoss: fg ? loss / fg : null, remainingBackground: bg ? residue / bg : null, edgeError: edge ? edgeError / edge : null, blackCompositeError: black / (rgba.length / 4 * 3) };
};
try {
  for (const [index, item] of [...corpus, ...fresh].entries()) {
    const input = await readFile(join(item.root, item.file));
    const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const start = performance.now();
    const prediction = replay ? { mask: await readFile(join(out, item.id + '.mask')), width: info.width, height: info.height } : await predict(input);
    if (workerRun && !Buffer.from(prediction.mask).equals(await readFile(join(out, item.id + '.mask')))) throw new Error('Worker prediction differs from reviewed mask: ' + item.id);
    if (!replay) await writeFile(join(out, item.id + '.mask'), prediction.mask);
    const result = await removeLocalBackground(input, { client: { predict: async () => prediction }, retry: false });
    if (!result.applied && !result.bytes.equals(input)) throw new Error('Original changed: ' + item.id);
    const returnedInfo = await sharp(result.bytes).metadata();
    if (returnedInfo.width !== info.width || returnedInfo.height !== info.height) throw new Error('Dimensions changed: ' + item.id);
    const raw = Buffer.from(data);
    for (let p = 0; p < prediction.mask.length; p++) raw[p * 4 + 3] = prediction.mask[p];
    const refined = matteEdges(raw, info.width, info.height);
    const truth = item.truth ? await sharp(join(item.root, item.truth)).ensureAlpha().raw().toBuffer() : null;
    await sharp(raw, { raw: info }).png().toFile(join(out, item.id + '-raw.png'));
    await sharp(refined.data, { raw: info }).png().toFile(join(out, item.id + '-diagnostic-refined.png'));
    await sharp(result.bytes).png().toFile(join(out, item.id + '-returned.png'));
    rows.push({ number: index + 1, ...item, applied: result.applied, reason: result.reason ?? null, mattingReason: refined.reason, unresolvedPixels: refined.unresolvedPixels, edgeCandidates: refined.edgeCandidates, rawMetrics: metrics(raw, truth), refinedMetrics: metrics(refined.data, truth), ms: performance.now() - start });
    await writeFile(join(out, workerRun ? 'worker-results.json' : 'results.json'), JSON.stringify({ model: MODEL, workerRun, rows }, null, 2));
    console.log(`${index + 1}/42 ${item.id}: ${result.applied ? 'processed' : result.reason}`);
  }
} finally { await predict?.close(); }
