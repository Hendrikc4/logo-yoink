import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { MODEL, RUNTIME_VERSION } from './background-removal-manifest.mjs';
import { backgroundRemovalPaths, sha256File } from './background-removal-paths.mjs';

export async function setupBackgroundRemoval({ cacheDirectory, onProgress = () => {} } = {}) {
  if (process.env.VERCEL) throw new Error('Background removal setup is only available on a local machine.');
  if (!/^[a-f0-9]{64}$/.test(MODEL.sha256) || !MODEL.url.startsWith('https://')) throw new Error('The background-removal model manifest is invalid.');
  const paths = backgroundRemovalPaths(cacheDirectory);
  await mkdir(paths.modelsDirectory, { recursive: true });
  await mkdir(paths.runtimeDirectory, { recursive: true });
  const lockPath = join(paths.cacheDirectory, 'setup.lock');
  try { await mkdir(lockPath); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Another setup is running. If it was interrupted, remove ${lockPath} and retry.`);
    throw error;
  }
  try {
    let installed;
    try { installed = JSON.parse(await readFile(join(paths.runtimeDirectory, 'node_modules/onnxruntime-node/package.json'), 'utf8')).version; } catch { /* First setup. */ }
    if (installed !== RUNTIME_VERSION) {
      onProgress(`Installing local CPU runtime onnxruntime-node@${RUNTIME_VERSION}…`);
      await new Promise((resolve, reject) => {
      const inheritedNpm = process.env.npm_execpath;
      const npmScript = inheritedNpm && basename(inheritedNpm) === 'npm-cli.js' ? inheritedNpm : (process.platform === 'win32' ? join(dirname(execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]), 'node_modules/npm/bin/npm-cli.js') : null);
        const npmArgs = ['install', '--prefix', paths.runtimeDirectory, '--no-audit', '--no-fund', '--omit=dev', '--save-exact', `onnxruntime-node@${RUNTIME_VERSION}`];
        const child = spawn(npmScript ? process.execPath : 'npm', npmScript ? [npmScript, ...npmArgs] : npmArgs, { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, ONNXRUNTIME_NODE_INSTALL_CUDA: 'skip' } });
        child.once('error', reject);
        child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Runtime installation exited with code ${code}.`)));
      });
    }
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', 'require(process.argv[1])', join(paths.runtimeDirectory, 'node_modules/onnxruntime-node')], { stdio: ['ignore', 'ignore', 'pipe'] });
      let detail = '';
      child.stderr.on('data', chunk => { detail = (detail + chunk).slice(-2000); });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Local ONNX runtime could not load (${code}). Remove ${paths.runtimeDirectory} and rerun logo-yoink setup-background-removal to reinstall it. ${detail}`)));
    });
    const modelPath = join(paths.modelsDirectory, `${MODEL.sha256}.onnx`);
    let valid = false;
    try { valid = await sha256File(modelPath) === MODEL.sha256; } catch { /* Download below. */ }
    if (!valid) {
      onProgress(`Downloading ${MODEL.id} (${MODEL.revision})…`);
      const temporary = `${modelPath}.${randomUUID()}.partial`;
      try {
        const response = await fetch(MODEL.url, { signal: AbortSignal.timeout(15 * 60 * 1000) });
        if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}.`);
        await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }));
        if (await sha256File(temporary) !== MODEL.sha256) throw new Error('Model checksum mismatch; rerun setup-background-removal to retry.');
        await rename(temporary, modelPath);
      } finally { await rm(temporary, { force: true }); }
    }
    const markerTemporary = `${paths.markerPath}.${randomUUID()}.partial`;
    try {
      await writeFile(markerTemporary, JSON.stringify({ model: MODEL.id, revision: MODEL.revision, sha256: MODEL.sha256, runtimeVersion: RUNTIME_VERSION }, null, 2));
      await rename(markerTemporary, paths.markerPath);
    } finally { await rm(markerTemporary, { force: true }); }
    onProgress('Background removal is ready. Inference now runs fully offline on the CPU.');
    return { model: MODEL.id, cacheDirectory: paths.cacheDirectory };
  } finally { await rm(lockPath, { recursive: true, force: true }); }
}
