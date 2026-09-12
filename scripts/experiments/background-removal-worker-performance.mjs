import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createBackgroundRemovalClient, createInferenceWorker, removeLocalBackground } from '../../src/background-removal.mjs';

// Install explicitly before this benchmark. Block JS network entry points in
// both parent and inference workers; model loading must be entirely local.
const guard = `import http from 'node:http'; import https from 'node:https'; import net from 'node:net'; import {syncBuiltinESMExports} from 'node:module'; const deny=()=>{throw new Error('Network disabled for offline inference verification')}; globalThis.fetch=deny; http.request=http.get=https.request=https.get=net.connect=net.createConnection=deny; syncBuiltinESMExports();`;
const guardUrl = 'data:text/javascript,' + encodeURIComponent(guard);
await import(guardUrl);
let workers = 0, exits = 0, childPid, peakCombinedMiB = 0;
const client = createBackgroundRemovalClient({ workerFactory: (url, options) => {
  workers++;
  const worker = createInferenceWorker(url, { ...options, execArgv: [...options.execArgv, '--import', guardUrl] });
  childPid = worker.pid;
  worker.on('exit', () => { exits++; childPid = undefined; });
  return worker;
} });
const dir = join(homedir(), '.cache/logo-yoink/background-removal/experiments');
const ids = ['s0-0-thin', 's1-0-dots', 's2-0-white-detail', 's3-0-gradient', 's7-0-disconnected', 'fresh-apple', 'fresh-google'];
const manifest = JSON.parse(await readFile('test/fixtures/background-removal/manifest.json')).map(x => ({ ...x, root: 'test/fixtures/background-removal' }));
const fresh = JSON.parse(await readFile('test/fixtures/background-removal-independent/results.json')).map(x => ({ ...x, id: 'fresh-' + x.name, root: 'test/fixtures/background-removal-independent' }));
const baselineMiB = process.memoryUsage().rss / 1024 ** 2;
const sampler = setInterval(() => {
  let childMiB = 0;
  if (childPid) try { childMiB = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(childPid)], { encoding: 'utf8' }).trim()) / 1024; } catch { /* Child just exited. */ }
  peakCombinedMiB = Math.max(peakCombinedMiB, process.memoryUsage().rss / 1024 ** 2 + childMiB);
}, 200);
const rows = [];
try {
  for (const id of ids) {
    const item = [...manifest, ...fresh].find(x => x.id === id);
    const bytes = await readFile(join(item.root, item.file));
    const start = performance.now();
    const result = await removeLocalBackground(bytes, { client });
    const ms = performance.now() - start;
    const reference = await readFile(join(dir, 'birefnet-512-tiled-performance', id + '.png'));
    assert.ok(result.bytes.equals(reference), `${id}: worker differs from experiment`);
    rows.push({ id, applied: result.applied, reason: result.reason ?? null, ms, rssMiB: process.memoryUsage().rss / 1024 ** 2 });
  }
  assert.equal(workers, 1, 'batch reuses a single initialization');
  const residentMiB = process.memoryUsage().rss / 1024 ** 2;
  await new Promise(resolve => setTimeout(resolve, 7_000));
  assert.equal(exits, 1, 'idle worker released');
  const idleMiB = process.memoryUsage().rss / 1024 ** 2;
  const results = { networkBlocked: true, workers, exits, baselineMiB, residentMiB, idleMiB, peakCombinedMiB, parentOsPeakMiB: process.resourceUsage().maxRSS / 1024, rows };
  await writeFile(join(dir, 'worker-performance.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { clearInterval(sampler); await client.close(); }
