#!/usr/bin/env node
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
const [beforePath,afterPath,outPath] = process.argv.slice(2);
if (!outPath) throw new Error('Usage: missing-logo-compare.mjs before/report.json after/report.json output-directory');
const read = async path=>JSON.parse(await readFile(path,'utf8'));
const before=await read(beforePath), after=await read(afterPath);
const inventory=await read('reports/missing-logo-program-2026-09-19/inventory.json');
const root=resolve(outPath); await mkdir(root,{recursive:true});
let visualReview=null;
try { visualReview=await read(join(root,'svg-final-review/review.json')); }
catch(error) { if(error.code!=='ENOENT')throw error; }
const reviewed=new Map((visualReview?.rows??[]).map(r=>[r.id,r]));
const prior=new Map(before.rows.map(r=>[r.id,r]));
const roles=r=>[...new Set(r.assets.flatMap(a=>a.selectedRoles))].sort();
const additions=[],regressions=[],changedDiscoveries=[];
for(const row of after.rows){
  const old=prior.get(row.id); if(!old) throw new Error('Missing paired baseline '+row.id);
  const oldRoles=roles(old),newRoles=roles(row);
  const added=newRoles.filter(r=>!oldRoles.includes(r)),lost=oldRoles.filter(r=>!newRoles.includes(r));
  if(lost.length) regressions.push({id:row.id,lost});
  if(JSON.stringify(old.candidates.map(c=>c.url))!==JSON.stringify(row.candidates.map(c=>c.url))) changedDiscoveries.push(row.id);
  if(added.length) {
    const review=reviewed.get(row.id);
    if(review && !row.assets.some(a=>a.rawHash===review.rawHash))throw new Error('Review bytes do not match '+row.id);
    additions.push({id:row.id,name:row.name,split:row.split,domain:row.domain,addedRoles:added,priorRoles:oldRoles,assets:row.assets.filter(a=>a.selectedRoles.some(r=>added.includes(r))),reviewStatus:review?.decision??'pending',review:review??null});
  }
}
const stage=row=>{
  if(row.assets.some(a=>a.selectedRoles.length)) return 'eligible_pending_visual_review';
  if(row.assets.some(a=>a.valid)) return 'role_or_theme_ineligible';
  if(row.assets.length) return row.assets[0].failure??'asset_failure';
  if(row.diagnostics.status==='no_verified_current_logo') return row.diagnostics.reason??row.diagnostics.status;
  return row.diagnostics.status;
};
const summaries={};
for(const split of ['development','holdout','all']){
 const b=before.rows.filter(r=>split==='all'||r.split===split),a=after.rows.filter(r=>split==='all'||r.split===split);
 const counts=rows=>({total:rows.length,discovered:rows.filter(r=>r.candidates.length).length,validated:rows.filter(r=>r.assets.some(a=>a.valid)).length,eligible:rows.filter(r=>roles(r).length).length,icon:rows.filter(r=>roles(r).includes('icon')).length,wide:rows.filter(r=>roles(r).includes('wide')).length});
 summaries[split]={before:counts(b),after:counts(a),stages:a.reduce((acc,r)=>(acc[stage(r)]=(acc[stage(r)]??0)+1,acc),{})};
}
const rowById=new Map(after.rows.map(r=>[r.id,r]));
const gaps=inventory.rows.map(r=>({...r,currentExperiment:r.missingAny ? rowById.has(r.id)?{stage:stage(rowById.get(r.id)),review:reviewed.get(r.id)??null,discoveryStatus:rowById.get(r.id).diagnostics,assets:rowById.get(r.id).assets.map(({ranking,...a})=>a)}:{stage:'frozen_evaluation_excluded'}:{stage:'approved_art_role_gaps_inventoried'}}));
await writeFile(join(root,'comparison.json'),JSON.stringify({before:resolve(beforePath),after:resolve(afterPath),summaries,visualReviewSummary:visualReview?.summary??null,additions,regressions,changedDiscoveries},null,2)+'\n');
await writeFile(join(root,'gap-analysis.json'),JSON.stringify({inventoryCounts:inventory.counts,rows:gaps},null,2)+'\n');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
for(const theme of ['light','dark']){
 const background=theme==='light'?'#ffffff':'#20242b', foreground=theme==='light'?'#111111':'#eeeeee';
 const panels=[];
 for(const row of additions)for(const asset of row.assets){
  const picture=await sharp(asset.validatedFile,{density:192}).resize(560,150,{fit:'contain',background}).flatten({background}).png().toBuffer();
  const label=Buffer.from(`<svg width="600" height="50"><text x="18" y="23" font-size="18" fill="${foreground}">${escape(row.name)} · ${row.split} · ${row.addedRoles.join(',')}</text></svg>`);
  panels.push(await sharp({create:{width:600,height:210,channels:4,background}}).composite([{input:label,left:0,top:0},{input:picture,left:20,top:50}]).png().toBuffer());
 }
 if(panels.length)await sharp({create:{width:1200,height:Math.ceil(panels.length/2)*210,channels:4,background}}).composite(panels.map((input,i)=>({input,left:i%2*600,top:Math.floor(i/2)*210}))).png().toFile(join(root,`new-candidates-${theme}.png`));
}
console.log(JSON.stringify({summaries,additions:additions.map(r=>({id:r.id,split:r.split,roles:r.addedRoles})),regressions,changedDiscoveries},null,2));
