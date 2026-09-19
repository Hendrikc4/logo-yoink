#!/usr/bin/env node
// Measure Wikimedia endpoint costs and lossless cache projection, without library writes.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i=args.indexOf(name); return i < 0 ? fallback : args[i+1]; };
const out = resolve(opt('--output', 'runs/missing-logo-program-2026-09-19/discovery/cost.json'));
const mode = opt('--mode', 'replay');
const spacingMs = Number(opt('--spacing-ms', mode === 'live' ? '1000' : '0'));
if (!Number.isFinite(spacingMs) || spacingMs < 0 || spacingMs > 60000) throw new Error('spacing-ms must be 0–60000.');
const collectedAt = new Date().toISOString();
const moduleUrl = new URL('../../src/wikimedia-fallback.mjs', import.meta.url);
const baseline = opt('--baseline', 'runs/missing-logo-program-2026-09-19/discovery/baseline-wikimedia-fallback.mjs');
const sources = { baseline: await readFile(baseline,'utf8'), treatment: await readFile(opt('--treatment', moduleUrl),'utf8') };
const resolvers = {};
for (const [name, source] of Object.entries(sources)) {
  const imported = source.replace(/from '([^']+)'/g, (_, s) => `from '${s.startsWith('.') ? new URL(s,moduleUrl).href : import.meta.resolve(s)}'`);
  resolvers[name] = (await import(`data:text/javascript;base64,${Buffer.from(imported).toString('base64')}`)).discoverWikimediaLogoCandidates;
}
const inventory=JSON.parse(await readFile('reports/missing-logo-program-2026-09-19/inventory.json'));
const allowed = new Set(inventory.rows.filter(r=>r.split==='development').map(r=>r.domain));
const domains=opt('--domains','se.com,bestbuy.com,singaporeair.com,berkshirehathaway.com,apple.com,amazon.com,pepsi.com').split(',');
for (const d of domains) if(!allowed.has(d)) throw new Error(`Not development: ${d}`);
const captures={};
for(const p of ['responses.json','validation-responses.json'])Object.assign(captures,JSON.parse(await readFile('runs/wikimedia-recall-2026-09-18/'+p)));
const rows=[];
const now=()=>new Date('2026-09-18T12:00:00Z');
const rounds=Number(opt('--rounds','1'));
trials: for(let round=0;round<rounds;round++)for(const domain of domains){
  // Alternate order to avoid always giving treatment warmed remote/CDN caches.
  for(const name of round%2 ? ['treatment','baseline']:['baseline','treatment']){
    const cache=new Map(),pending=new Map();
    const fetchImpl=async(url,init)=>{
      if(mode==='live')return fetch(url,init);
      const saved=captures[String(url)];if(!saved)throw new Error(`Uncaptured ${url}`);
      return new Response(saved.body,{status:saved.status,headers:saved.headers});
    };
    for(const phase of ['cold','warm']){
      if (rows.length && spacingMs) await new Promise(resolve => setTimeout(resolve, spacingMs));
      const network={requests:0,bytesDownloaded:0};const start=performance.now();
      const result=await resolvers[name]({domain,missingRoles:['icon','wide']},{fetchImpl,cache,pending,now,timeoutMs:Number(opt('--timeout-ms','5000')),diagnostics:network,
        ...(mode==='replay'?{validateUrl:async url=>new URL(url)}:{})});
      const row={round,domain,name,phase,durationMs:Math.round((performance.now()-start)*100)/100,network,
        retainedCacheBytes:[...cache.values()].reduce((s,v)=>s+v.bytes,0), ...result};
      rows.push(row);console.log(JSON.stringify({domain,name,phase,status:row.diagnostics.status,ms:row.durationMs,bytes:network.bytesDownloaded,retained:row.retainedCacheBytes}));
      if (mode==='live' && row.diagnostics.status==='rate_limited') break trials;
    }
  }
}
const report={mode,collectedAt,spacingMs,now:now().toISOString(),rounds,sourceHashes:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,createHash('sha256').update(v).digest('hex')])),rows};
await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');
