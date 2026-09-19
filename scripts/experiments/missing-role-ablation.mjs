#!/usr/bin/env node
// Exploratory role-semantic replay; does not modify eligibility thresholds or library records.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { rankCandidates } from '../../src/rank.mjs';
const args=process.argv.slice(2), opt=(key, fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const input=resolve(opt('--input','runs/missing-logo-program-2026-09-19/roles/audit.json'));
const output=resolve(opt('--output','runs/missing-logo-program-2026-09-19/roles'));
const rows=JSON.parse(await readFile(input,'utf8'));
await mkdir(output,{recursive:true});
const preferences={logo:{theme:'light'},icon:{theme:'light'}};
const results=[], panels=[];
const esc=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
for(const row of rows.filter(row=>row.validated)) {
 const candidate=row.candidate;
 const filename=candidate.source==='wikimedia-commons'&&candidate.evidence?.wikidata_identity_verified===true
  ?candidate.evidence.commons_canonical_filename??'':'';
 // Rejected experiment stays isolated: production does not consume filenames.
 const experimentalCandidate={...candidate,evidence:{...candidate.evidence,local_semantic:`${candidate.evidence?.local_semantic??''} ${filename}`}};
 const before=rankCandidates([candidate],{companyName:row.name,preferences});
 const after=rankCandidates([experimentalCandidate],{companyName:row.name,preferences});
 const selected=x=>Object.keys(x.assets).filter(k=>x.assets[k]);
 const baseline=selected(before), patched=selected(after);
 const changed=JSON.stringify(baseline)!==JSON.stringify(patched);
 results.push({id:row.id,name:row.name,baseline,treatment:patched,changed,url:candidate.url,hash:candidate.observed?.byte_hash,filename,width:candidate.width,height:candidate.height,caution:before.candidates[0].wordmark_caution});
 const bytes=Buffer.from(candidate.dataUrl.split(',')[1],'base64');
 const path=resolve(output,`${row.id}.${candidate.format}`);
 await writeFile(path,bytes);
 const mark=await sharp(bytes,{density:192}).resize(310,100,{fit:'contain',background:'#fff'}).flatten({background:'#fff'}).png().toBuffer();
 const label=Buffer.from(`<svg width="340" height="65"><text x="10" y="20" font-size="16">${esc(row.name)}</text><text x="10" y="42" font-size="12">${esc(`${baseline.join('+')||'none'} → ${patched.join('+')||'none'}`)}</text></svg>`);
 panels.push(await sharp({create:{width:340,height:180,channels:4,background:'#fff'}}).composite([{input:label,left:0,top:0},{input:mark,left:15,top:65}]).png().toBuffer());
}
const summary={input,thresholdsChanged:false,validated:results.length,baseline:results.filter(r=>r.baseline.length).length,treatment:results.filter(r=>r.treatment.length).length,changes:results.filter(r=>r.changed),results};
await writeFile(resolve(output,'role-ablation.json'),JSON.stringify(summary,null,2)+'\n');
await sharp({create:{width:1020,height:Math.ceil(panels.length/3)*180,channels:4,background:'#ddd'}}).composite(panels.map((input,i)=>({input,left:i%3*340,top:Math.floor(i/3)*180}))).png().toFile(resolve(output,'roles-review.png'));
console.log(JSON.stringify({...summary,results:undefined},null,2));
