import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MODEL, RUNTIME_VERSION } from './background-removal-manifest.mjs';
import { sha256File } from './background-removal-paths.mjs';
import { createPredictor } from './background-removal-inference.mjs';

let predictor, workerData;
// Never leave an orphan model process after its caller exits.
process.on('disconnect', () => process.exit(0));
function reply(message) {
  if (!process.connected) return;
  // A parent can disconnect between the connected check and the asynchronous
  // write. Supplying a callback prevents an unhandled process error (EPIPE).
  process.send(message, error => { if (error) process.exit(0); });
}
async function initialize() {
  let marker;
  try { marker = JSON.parse(await readFile(workerData.markerPath, 'utf8')); }
  catch { throw Object.assign(new Error('Run logo-yoink setup-background-removal before enabling background removal.'), { code: 'setup-required' }); }
  const modelPath = join(workerData.modelsDirectory, `${MODEL.sha256}.onnx`);
  try {
    if (marker.sha256 !== MODEL.sha256 || marker.runtimeVersion !== RUNTIME_VERSION || await sha256File(modelPath) !== MODEL.sha256) throw new Error('Installation mismatch');
    const runtime = JSON.parse(await readFile(join(workerData.runtimeDirectory, 'node_modules/onnxruntime-node/package.json'), 'utf8'));
    if (runtime.version !== RUNTIME_VERSION) throw new Error('Runtime mismatch');
  } catch { throw Object.assign(new Error('Background removal installation is missing, outdated or corrupt. Rerun logo-yoink setup-background-removal.'), { code: 'installation-invalid' }); }
  return createPredictor({ modelPath, runtimeDirectory: workerData.runtimeDirectory, ...MODEL });
}
process.on('message', async ({ id, bytes, type, paths }) => {
  if (type === 'configure') { workerData = paths; return; }
  if (type === 'dispose') {
    try { if (predictor) await (await predictor).close(); }
    catch { /* Termination remains the fallback if the runtime cannot release. */ }
    predictor = undefined;
    reply({ type: 'disposed' });
    return;
  }
  try {
    predictor ??= initialize();
    const prediction = await (await predictor)(Buffer.from(bytes));
    reply({ id, prediction });
  } catch (error) {
    try { if (predictor) await (await predictor).close(); } catch { /* Preserve the original inference failure. */ }
    predictor = undefined;
    reply({ id, error: { code: error.code || 'inference-failed', message: error.message } });
  }
});
