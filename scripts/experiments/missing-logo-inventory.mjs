#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';

const output = process.argv[2] ?? 'reports/missing-logo-program-2026-09-19/inventory.json';
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const manifestPath = 'brand-library/v2/manifest.json';
const rosterPath = 'brand-library/v2/sources.json';
const manifest = await read(manifestPath);
const exposed = new Set();
// Prior experiment exposure is recorded explicitly, never mislabelled holdout.
for (const name of await readdir('runs/wikimedia-recall-2026-09-18')) {
  if (!name.endsWith('.json')) continue;
  const value = await read(join('runs/wikimedia-recall-2026-09-18',name));
  for (const row of value.rows ?? []) if (row.domain) exposed.add(row.domain);
}
const frozen = new Set();
for (const name of await readdir('benchmarks')) {
  try {
    const rows = (await readFile(join('benchmarks',name,'splits/evaluation.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    for (const row of rows) if (row.website) frozen.add(new URL(/^https?:/.test(row.website) ? row.website : 'https://'+row.website).hostname.replace(/^www\./,''));
  } catch (error) { if (!['ENOENT','ENOTDIR'].includes(error.code)) throw error; }
}
const research = new Map();
for (const name of await readdir('brand-library/v2/deep-search')) {
  if (!name.endsWith('.json')) continue;
  const path = join('brand-library/v2/deep-search',name);
  for (const row of (await read(path)).results ?? []) {
    const values = research.get(row.brandId) ?? [];
    values.push({file:path,status:row.status,reason:row.reason,candidates:row.candidates??[]});
    research.set(row.brandId,values);
  }
}
const rights = new Map((await read('brand-library/v2/rights-notes.json')).records.map(r=>[r.brandId,r]));
const rows = manifest.brands.map(r=>{
  const split = frozen.has(r.domain) ? 'frozen-evaluation-excluded' : exposed.has(r.domain) || parseInt(sha('missing-logo-v1:'+r.domain).slice(0,8),16)%10<7 ? 'development' : 'holdout';
  const roles = Object.keys(r.assets??{});
  return {id:r.id,name:r.name,domain:r.domain,split,previouslyExposed:exposed.has(r.domain),missingAny:roles.length===0,missingIcon:!roles.includes('icon'),missingWide:!roles.includes('logo'),approvedRoles:roles,verificationStatus:r.verificationStatus,notes:r.notes,rights:rights.get(r.id)??null,research:research.get(r.id)??[]};
});
const controls = rows.filter(r=>!r.missingAny&&r.split!=='frozen-evaluation-excluded').sort((a,b)=>sha('controls-v1:'+a.domain).localeCompare(sha('controls-v1:'+b.domain))).slice(0,40).map(r=>r.id);
const count = fn => rows.filter(fn).length;
const counts = {identities:rows.length,withApprovedArt:count(r=>!r.missingAny),primaryAssets:rows.reduce((n,r)=>n+r.approvedRoles.length,0),assets:manifest.brands.reduce((n,r)=>n+Object.keys(r.assets??{}).length+Object.values(r.variants??{}).flat().length,0),missingAny:count(r=>r.missingAny),missingIcon:count(r=>r.missingIcon),missingWide:count(r=>r.missingWide),missingAnySplits:rows.filter(r=>r.missingAny).reduce((a,r)=>(a[r.split]=(a[r.split]??0)+1,a),{})};
const inventory = {schemaVersion:1,createdAt:'2026-09-19',splitRule:'sha256(missing-logo-v1:domain) first uint32 mod10 <7 development; remaining holdout; prior exposed forced development; official frozen evaluation domains excluded from tuning/experiment',rosterSha256:sha(await readFile(rosterPath)),manifestSha256:sha(await readFile(manifestPath)),counts,controls,rows};
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(inventory,null,2)+'\n');
console.log(JSON.stringify(counts));
