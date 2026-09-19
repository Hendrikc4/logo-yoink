#!/usr/bin/env node
// Paired static/deep official discovery from one capture, keeping production role/safety rules.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { extractLogos } from '../../src/extractor.mjs';
import { rankCandidates } from '../../src/rank.mjs';
const args=process.argv.slice(2), opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const ids=opt('--ids','lowe-s,best-buy,lyft,3m,gopro,carrefour,abb,bank-of-america').split(',');
const output=resolve(opt('--output','runs/missing-logo-program-2026-09-19/roles/official'));
await mkdir(output,{recursive:true});
const manifest=JSON.parse(await readFile('brand-library/v2/manifest.json','utf8'));
const preferences={icon:{theme:'light'},logo:{theme:'light'}};
const summary=[];
for(const id of ids){
 const brand=manifest.brands.find(x=>x.id===id);if(!brand)throw new Error(`Unknown brand ${id}`);
 const started=performance.now();
 try{
  const r=await extractLogos(brand.domain,{companyName:brand.name,jinaApiKey:'',timeoutMs:4000,maxCandidates:16,preferences,deepWide:true,forceDeepWide:true,deepWidePages:2,browser:false,cachedFavicon:false,wikimediaFallback:true,wikimediaResolver:async()=>({candidates:[],diagnostics:{status:'disabled_for_official_ablation'}}),linkedin:false,bimi:false,jinaScreenshot:false});
  const baseline=rankCandidates(r.candidates.filter(c=>!c.evidence?.deep_official),{companyName:brand.name,preferences});
  const selected=x=>Object.fromEntries(Object.entries(x.assets).map(([role,c])=>[role,c?{url:c.url,hash:c.observed?.byte_hash}:null]));
  const row={id,name:brand.name,baseline:selected(baseline),treatment:selected(r),additionalCandidates:r.candidates.filter(c=>c.evidence?.deep_official).length,diagnostics:r.diagnostics,durationMs:Math.round(performance.now()-started)};
  await writeFile(resolve(output,id+'.json'),JSON.stringify(r,null,2));
  summary.push(row);
  console.log(JSON.stringify({id,baseline:Object.keys(row.baseline).filter(k=>row.baseline[k]),treatment:Object.keys(row.treatment).filter(k=>row.treatment[k]),extra:row.additionalCandidates,durationMs:row.durationMs}));
 }catch(e){summary.push({id,error:e.message,diagnostics:e.diagnostics,durationMs:Math.round(performance.now()-started)});console.log(id,e.message)}
 await writeFile(resolve(output,'summary.json'),JSON.stringify({method:'Single capture; baseline ranks all non-deep candidates, treatment includes deep official candidates. No ranked candidate displacement correction; exploratory ablation only.',preferences,rows:summary},null,2));
}
