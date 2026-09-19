#!/usr/bin/env node
// Research-only captured evaluation. Does not mutate library approvals or frozen benchmarks.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { fetchTimed, readLimited } from '../../src/http-client.mjs';
import { safeCommonsUrl } from '../../src/wikimedia-fallback.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const root = resolve(option('--output', 'runs/missing-logo-program-2026-09-19/baseline-all'));
const captureRoot = resolve(option('--capture', 'runs/missing-logo-program-2026-09-19/captures'));
const sourceRoot = resolve(option('--source', 'src'));
const inventory = JSON.parse(await readFile('reports/missing-logo-program-2026-09-19/inventory.json', 'utf8'));
const split = option('--split', 'development');
const offline = args.includes('--offline');
const controls = args.includes('--controls');
const claimTime = new Date(option('--claim-time', '2026-09-19T00:00:00Z'));
const domains = option('--domains', '')?.split(',').filter(Boolean);
const timeoutMs = Number(option('--timeout-ms', '10000'));
const workers = Number(option('--workers', offline ? '3' : '1'));
const intervalMs = Number(option('--request-interval-ms', '600'));
if (!(Number.isInteger(workers) && workers >= 1 && workers <= 6 && timeoutMs >= 250 && timeoutMs <= 10000 &&
      Number.isFinite(intervalMs) && intervalMs >= 250 && intervalMs <= 10000 && Number.isFinite(claimTime.getTime()))) throw new Error('Invalid budgets or claim time');
const brands = inventory.rows.filter(row => row.split !== 'frozen-evaluation-excluded' &&
  (domains?.length ? domains.includes(row.domain) : controls ? inventory.controls.includes(row.id) : row.missingAny && (split === 'all' || row.split === split)));
const { discoverWikimediaLogoCandidates } = await import(pathToFileURL(join(sourceRoot, 'wikimedia-fallback.mjs')));
const { internals: extractor } = await import(pathToFileURL(join(sourceRoot, 'extractor.mjs')));
const { rankCandidates } = await import(pathToFileURL(join(sourceRoot, 'rank.mjs')));
await mkdir(join(root, 'rows'), { recursive: true });
await mkdir(join(root, 'validated'), { recursive: true });
await mkdir(captureRoot, { recursive: true });
const sha = value => createHash('sha256').update(value).digest('hex');
const sourceHashes = Object.fromEntries(await Promise.all(['wikimedia-fallback.mjs','extractor.mjs','standalone-svg.mjs','rank.mjs','asset-model.mjs'].map(async file => [file, sha(await readFile(join(sourceRoot,file)))])));
let liveRequests = 0, captureHits = 0;
let requestQueue = Promise.resolve(), nextRequestAt = 0;
const hostCooldown = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const scheduledFetch = async (url, init) => {
  const host = new URL(url).hostname;
  // The census is intentionally slower than production: honor provider-wide
  // Retry-After, including across companies, and avoid synchronized bursts.
  const task = requestQueue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = Math.max(nextRequestAt, hostCooldown.get(host) ?? 0) - Date.now();
      if (wait > 0) await sleep(wait);
      nextRequestAt = Date.now() + intervalMs;
      // Queue waiting is outside the per-request network deadline.
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      liveRequests++;
      if (![429,503].includes(response.status)) return response;
      const header = response.headers.get('retry-after');
      const delay = header !== null && Number.isFinite(Number(header)) ? Number(header)*1000 : Math.max(0,Date.parse(header)-Date.now()) || 60000;
      hostCooldown.set(host, Date.now()+Math.max(delay,1000));
      console.log(JSON.stringify({transport:'cooldown',host,status:response.status,delayMs:delay}));
      if (attempt === 2) return response;
      await response.body?.cancel();
    }
  });
  requestQueue = task.catch(()=>{});
  return task;
};
const fetchImpl = async (url, init) => {
  const key = String(url), path = join(captureRoot, sha(key) + '.json');
  let record;
  try { record = JSON.parse(await readFile(path, 'utf8')); captureHits++; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!record) {
    if (offline) throw new Error(`Uncaptured request: ${key}`);
    const response = await scheduledFetch(url, init);
    const { bytes } = await readLimited(response, 4 * 1024 * 1024, { timeoutMs });
    record = { url: key, capturedAt: new Date().toISOString(), status: response.status, headers: Object.fromEntries(response.headers), body: bytes.toString('base64') };
    const temporary = path + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(record));
    await rename(temporary, path);
  }
  const response = new Response(Buffer.from(record.body, 'base64'), { status: record.status, headers: record.headers });
  Object.defineProperty(response, 'url', { value: key });
  return response;
};
const rows = [];
let next = 0;
await Promise.all(Array.from({length: workers}, async () => {
  while (next < brands.length) {
    const brand = brands[next++], path = join(root, 'rows', brand.id + '.json');
    if (args.includes('--resume')) {
      try { const saved = JSON.parse(await readFile(path,'utf8')); if (JSON.stringify(saved.sourceHashes) !== JSON.stringify(sourceHashes)) throw new Error('Resume source mismatch'); rows.push(saved); continue; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const network = {requests: 0, bytesDownloaded: 0};
    const started = performance.now();
    const discovery = await discoverWikimediaLogoCandidates({domain: brand.domain, missingRoles:['icon','wide']}, {fetchImpl, cache: new Map(), timeoutMs, diagnostics:network, now:()=>claimTime});
    const discoveryMs = Math.round(performance.now()-started);
    const assets = [];
    for (const candidate of discovery.candidates) {
      const asset = {url:candidate.url, evidence:candidate.evidence, provenance:candidate.provenance, downloadStatus:null, valid:false, selectedRoles:[], blockers:{}};
      try {
        const response = await fetchTimed(candidate.url, {timeoutMs,fetchImpl,diagnostics:network});
        asset.downloadStatus = response.status;
        if (!response.ok) { asset.failure='http_'+response.status; await response.body?.cancel(); assets.push(asset); continue; }
        if (!safeCommonsUrl(response.url, 'upload.wikimedia.org', '/wikipedia/commons/')) {
          asset.failure='unsafe_commons_redirect'; await response.body?.cancel(); assets.push(asset); continue;
        }
        const {bytes} = await readLimited(response, 3*1024*1024,{timeoutMs,diagnostics:network});
        asset.rawHash = sha(bytes);
        const validated = await extractor.validateCandidateBytes(candidate, bytes, {resolvedUrl:response.url,status:response.status,contentType:response.headers.get('content-type')});
        if (!validated) asset.failure = 'unsafe_malformed_or_unrenderable';
        else {
          asset.valid = true;
          const ranked = rankCandidates([validated], {preferences:{logo:{theme:'light'},icon:{theme:'light'}}});
          asset.selectedRoles = ['icon','wide'].filter(role=>ranked.selectedByRole[role]);
          asset.ranking = ranked.candidates.map(({dataUrl,...r})=>r);
          asset.validatedFile = join(root,'validated',brand.id+'.'+validated.format);
          await writeFile(asset.validatedFile, Buffer.from(validated.dataUrl.split(',')[1],'base64'));
          if (!asset.selectedRoles.length) asset.failure='role_or_theme_ineligible';
        }
      } catch(error) { asset.failure = error.name==='AbortError' ? 'asset_timeout' : 'asset_fetch_error'; asset.error = error.message; }
      assets.push(asset);
    }
    const row = {id:brand.id,name:brand.name,domain:brand.domain,split:brand.split,sourceHashes,discoveryMs,totalMs:Math.round(performance.now()-started),network,...discovery,assets};
    rows.push(row); await writeFile(path,JSON.stringify(row,null,2)+'\n');
    console.log(JSON.stringify({id:row.id,split:row.split,status:row.diagnostics.status,roles:assets.flatMap(a=>a.selectedRoles),ms:row.totalMs}));
  }
}));
rows.sort((a,b)=>a.id.localeCompare(b.id));
const count = pred => rows.filter(pred).length;
const summary = {total:rows.length,discovered:count(r=>r.candidates.length),validated:count(r=>r.assets.some(a=>a.valid)),eligible:count(r=>r.assets.some(a=>a.selectedRoles.length)),icon:count(r=>r.assets.some(a=>a.selectedRoles.includes('icon'))),wide:count(r=>r.assets.some(a=>a.selectedRoles.includes('wide'))),statuses:rows.reduce((a,r)=>(a[r.diagnostics.status]=(a[r.diagnostics.status]??0)+1,a),{}),requests:rows.reduce((a,r)=>a+r.network.requests,0),bytes:rows.reduce((a,r)=>a+r.network.bytesDownloaded,0)};
await writeFile(join(root,'report.json'),JSON.stringify({createdAt:new Date().toISOString(),claimTime:claimTime.toISOString(),sourceRoot,sourceHashes,offline,split,controls,timeoutMs,workers,requestIntervalMs:intervalMs,liveRequests,captureHits,summary,rows},null,2)+'\n');
console.log(JSON.stringify(summary));
