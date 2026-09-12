import sharp from 'sharp';
import { matteEdges } from './background-removal-matting.mjs';
import { MODEL } from './background-removal-manifest.mjs';
import { assessMask } from './background-removal-safety.mjs';
import { reconstructFlatBackground, assessInteriorDetails } from './background-removal-flat.mjs';
import { fork } from 'node:child_process';
import { backgroundRemovalPaths } from './background-removal-paths.mjs';

function workerExecArgv() {
  const args = [];
  for (let index = 0; index < process.execArgv.length; index++) {
    const arg = process.execArgv[index];
    if (['--input-type', '-e', '--eval', '-p', '--print'].includes(arg)) { index++; continue; }
    if (!['--input-type=', '--eval=', '--print='].some(prefix => arg.startsWith(prefix))) args.push(arg);
  }
  return args;
}

// A separate process lets the OS reclaim native ONNX allocator pages on exit.
// Worker threads leave those pages in the long-lived API process on some systems.
export function createInferenceWorker(url, { workerData, execArgv = workerExecArgv() }) {
  const child = fork(url, [], { execArgv, serialization: 'advanced', stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const ref = child.ref.bind(child), unref = child.unref.bind(child);
  child.ref = () => { ref(); child.channel?.ref(); };
  child.unref = () => { unref(); child.channel?.unref(); };
  child.postMessage = message => child.send(message, error => { if (error) child.emit('error', error); });
  let termination;
  child.terminate = () => termination ??= new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(child.exitCode); return; }
    child.once('exit', resolve);
    child.kill('SIGKILL');
  });
  child.postMessage({ type: 'configure', paths: workerData });
  return child;
}

export function createBackgroundRemovalClient({ workerFactory = createInferenceWorker, timeoutMs = 120_000, idleTimeoutMs = 5_000, maxPending = 8, cacheDirectory } = {}) {
  let worker, idleTimer, pending = 0, nextId = 0, chain = Promise.resolve(), retirement = Promise.resolve();
  function retire(current, graceful = false) {
    // Awaiting a promise alone does not keep Node alive. A caller may await
    // close() immediately after the last request unrefs this child and its IPC.
    current.ref();
    if (worker === current) worker = undefined;
    // Do not initialize another native session until the old worker has exited.
    retirement = (async () => {
      if (graceful) await new Promise(resolve => {
        const done = () => { clearTimeout(timer); current.off('message', disposed); current.off('exit', done); current.off('error', done); resolve(); };
        const disposed = message => { if (message.type === 'disposed') done(); };
        const timer = setTimeout(done, 1_000);
        timer.unref();
        current.on('message', disposed); current.once('exit', done); current.once('error', done);
        try { current.postMessage({ type: 'dispose' }); } catch { done(); }
      });
      await current.terminate();
    })().catch(() => {});
  }
  const destroy = () => {
    clearTimeout(idleTimer);
    if (worker) retire(worker, pending === 0);
    return retirement;
  };
  function scheduleIdleRelease() {
    clearTimeout(idleTimer);
    if (pending || !worker) return;
    idleTimer = setTimeout(destroy, idleTimeoutMs);
    idleTimer.unref();
  }
  async function run(bytes) {
    await retirement;
    return new Promise((resolve, reject) => {
      if (!worker) {
        worker = workerFactory(new URL('./background-removal-worker.mjs', import.meta.url), { workerData: backgroundRemovalPaths(cacheDirectory), execArgv: workerExecArgv() });
        const created = worker;
        // Retain idle listeners: a native runtime can fail between requests too.
        created.on('error', () => { if (worker === created) retire(created); });
        created.on('exit', () => { if (worker === created) worker = undefined; });
      }
      const current = worker, id = ++nextId;
      current.ref();
      const cleanup = () => { clearTimeout(timer); current.off('message', message); current.off('error', failure); current.off('exit', exited); if (worker === current) current.unref(); };
      const failure = error => { cleanup(); if (worker === current) retire(current); reject(Object.assign(error, { code: error.code || 'worker-failed' })); };
      const exited = code => failure(Object.assign(new Error(`Background removal worker exited (${code}). Retry the operation.`), { code: 'worker-failed' }));
      const message = result => {
        if (result.id !== id) return;
        cleanup();
        if (result.error) reject(Object.assign(new Error(result.error.message), { code: result.error.code }));
        else resolve(result.prediction);
      };
      const timer = setTimeout(() => failure(Object.assign(new Error('Local model inference timed out. Original image preserved; retry on a less busy machine.'), { code: 'inference-timeout' })), timeoutMs);
      current.on('message', message); current.once('error', failure); current.once('exit', exited);
      try { current.postMessage({ id, bytes }); } catch (error) { failure(error); }
    });
  }
  return {
    predict(bytes) {
      if (pending >= maxPending) return Promise.reject(Object.assign(new Error('Local background removal queue is full. Retry after current operations finish.'), { code: 'queue-full' }));
      clearTimeout(idleTimer);
      pending++;
      const result = chain.then(() => run(bytes));
      chain = result.catch(() => {}).finally(() => { pending--; scheduleIdleRelease(); });
      return result;
    },
    close: destroy,
  };
}

let defaultClient;
async function removeOnce(bytes, { client } = {}) {
  if (process.env.VERCEL) return { bytes, applied: false, reason: 'local-only', message: 'Background removal is available only in local CLI, JavaScript and local API use.' };
  try {
    const { data, info } = await sharp(bytes, { animated: false, limitInputPixels: 64 * 1024 * 1024 }).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let offset = 3; offset < data.length; offset += 4) if (data[offset] < 255) return { bytes, applied: false, reason: 'already-transparent' };
    const prediction = await (client ?? (defaultClient ??= createBackgroundRemovalClient())).predict(bytes);
    const mask = prediction.mask;
    if (mask.length !== info.width * info.height) throw Object.assign(new Error('The model returned incorrect mask dimensions.'), { code: 'unsafe-mask' });
    const flat = reconstructFlatBackground(data, mask, info.width, info.height);
    if (flat) {
      const corrected = matteEdges(flat, info.width, info.height);
      const alpha = Buffer.alloc(mask.length);
      for (let p = 0; p < mask.length; p++) alpha[p] = corrected.data[p * 4 + 3];
      if (!corrected.reason && !assessMask(data, alpha, info.width, info.height) && !assessInteriorDetails(data, alpha, info.width, info.height)) return { bytes: await sharp(corrected.data, { raw: info }).png().toBuffer(), applied: true, method: 'local-onnx-flat-matting', model: MODEL.id, revision: MODEL.revision, preset: MODEL.preset };
    }
    let removed = 0, retained = 0;
    for (const value of mask) { if (value < 128) removed++; if (value > 240) retained++; }
    if (removed / mask.length < 0.01 || retained / mask.length < 0.005 || removed / mask.length > 0.995) return { bytes, applied: false, reason: 'unsafe-mask', message: 'The mask removed too much or too little; original preserved.' };
    for (let pixel = 0; pixel < mask.length; pixel++) data[pixel * 4 + 3] = mask[pixel];
    const matting = matteEdges(data, info.width, info.height);
    // Judge the alpha we actually return: local matting can restore weak model
    // edges, but can also damage details. Compare against original RGB, never
    // the recolored foreground produced by matting.
    const finalMask = Buffer.alloc(mask.length);
    for (let pixel = 0; pixel < mask.length; pixel++) finalMask[pixel] = matting.data[pixel * 4 + 3];
    const safetyReason = assessMask(data, finalMask, info.width, info.height) || assessInteriorDetails(data, finalMask, info.width, info.height);
    if (safetyReason) return { bytes, applied: false, reason: safetyReason, message: 'The refined mask could not safely preserve the logo details; original preserved.' };
    if (matting.reason) return { bytes, applied: false, reason: matting.reason, message: 'The logo edges could not be separated confidently from the background; original preserved.' };
    return { bytes: await sharp(matting.data, { raw: info }).png().toBuffer(), applied: true, method: 'local-onnx-cpu', model: MODEL.id, revision: MODEL.revision, preset: MODEL.preset ?? (MODEL.padding ? 'padded-soft' : 'native-soft') };
  } catch (error) {
    return { bytes, applied: false, reason: error.code || 'inference-failed', message: error.message };
  }
}

export async function removeLocalBackground(bytes, { client, retry = true } = {}) {
  const first = await removeOnce(bytes, { client });
  if (!retry || first.applied || !['foreground-loss', 'foreground-component-loss', 'background-retained', 'edge-uncertain', 'unsafe-mask', 'interior-detail-uncertain'].includes(first.reason)) return first;
  // One alternate model view; the original RGB and original-size safety checks
  // remain authoritative. Never load a second or higher-resolution model.
  try {
    const { data, info } = await sharp(bytes).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    const border = [];
    for (let x = 0; x < info.width; x++) border.push(x, (info.height - 1) * info.width + x);
    for (let y = 1; y < info.height - 1; y++) border.push(y * info.width, y * info.width + info.width - 1);
    const rgb = [0, 1, 2].map(c => border.map(p => data[p * 3 + c]).sort((a, b) => a - b)[Math.floor(border.length / 2)]);
    const margin = Math.min(128, Math.max(8, Math.ceil(Math.min(info.width, info.height) * 0.12)));
    const padded = await sharp(bytes).extend({ left: margin, right: margin, top: margin, bottom: margin, background: { r: rgb[0], g: rgb[1], b: rgb[2] } }).png().toBuffer();
    const active = client ?? (defaultClient ??= createBackgroundRemovalClient());
    const second = await removeOnce(bytes, { client: { predict: async () => {
      const prediction = await active.predict(padded);
      const width = info.width + margin * 2, height = info.height + margin * 2;
      if (prediction.mask.length !== width * height) throw Object.assign(new Error('Invalid retry mask dimensions.'), { code: 'unsafe-mask' });
      const mask = Buffer.alloc(info.width * info.height);
      for (let y = 0; y < info.height; y++) Buffer.from(prediction.mask.buffer, prediction.mask.byteOffset + ((y + margin) * width + margin), info.width).copy(mask, y * info.width);
      return { mask, width: info.width, height: info.height };
    } } });
    return second.applied ? { ...second, attempts: 2 } : { ...first, attempts: 2 };
  } catch { return { ...first, attempts: 2 }; }
}
