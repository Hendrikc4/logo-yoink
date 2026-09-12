// Render every raw diagnostic and returned result; no inference is run here.
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
const root='runs/background-removal-all-42', out=join(root,'visual');
await mkdir(out,{recursive:true});
const report=JSON.parse(await readFile(join(root,'results.json')));
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');
const label=(s,w,h=36)=>Buffer.from(`<svg width="${w}" height="${h}"><rect width="100%" height="100%" fill="#e3e9f0"/><text x="8" y="24" font-family="Arial" font-size="13">${esc(s)}</text></svg>`);
const thumbs=[];
for(const item of report.rows){
 const input=await readFile(join(item.root,item.file));
 const files=[input,item.truth?await readFile(join(item.root,item.truth)):input,...await Promise.all(['raw','diagnostic-refined','returned'].map(s=>readFile(join(root,`${item.id}-${s}.png`))))];
 const {width:w,height:h}=await sharp(input).metadata();
 const labels=['Original',item.truth?'Known-alpha reference':'No alpha reference','Raw prediction: diagnostic only','Refinement: diagnostic only',`Returned: ${item.applied?'processed':'ORIGINAL RETAINED'}`];
 for(const scale of [1,4]){
  const cw=Math.max(w*scale,260),ch=h*scale,header=72, comps=[];
  comps.push({input:label(`${item.number}. ${item.id} | ${item.reason||'processed'}`,cw*5),left:0,top:0});
  for(let c=0;c<5;c++){
   comps.push({input:label(labels[c],cw),left:c*cw,top:36});
   for(let b=0;b<3;b++){
    const bg=b===0?'#fff':b===1?'#000':'url(#c)';
    const s=8*scale,svg=Buffer.from(`<svg width="${cw}" height="${ch}"><defs><pattern id="c" width="${s*2}" height="${s*2}" patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="#eee"/><path d="M0 0h${s}v${s}H0zM${s} ${s}h${s}v${s}H${s}z" fill="#aaa"/></pattern></defs><rect width="100%" height="100%" fill="${bg}"/></svg>`);
    const resized=await sharp(files[c]).resize(w*scale,h*scale,{kernel:'nearest'}).png().toBuffer();
    comps.push({input:await sharp(svg).composite([{input:resized,left:Math.floor((cw-w*scale)/2),top:0}]).png().toBuffer(),left:c*cw,top:header+b*ch});
   }
  }
  await sharp({create:{width:cw*5,height:header+ch*3,channels:3,background:'#fff'}}).composite(comps).png().toFile(join(out,`${String(item.number).padStart(2,'0')}-${item.id}-${scale}x.png`));
 }
 const tw=260,th=160, comps=[{input:label(`${item.number}. ${item.id}: ${item.applied?'processed':'retained'}`,tw*5),top:0,left:0}];
 for(let c=0;c<5;c++){
  const panel=await sharp(files[c]).resize(tw-16,th-16,{fit:'inside'}).flatten({background:'#333'}).png().toBuffer();
  const m=await sharp(panel).metadata();
  comps.push({input:label(labels[c],tw),top:36,left:c*tw});
  comps.push({input:panel,left:c*tw+Math.floor((tw-m.width)/2),top:72+Math.floor((th-m.height)/2)});
 }
 thumbs.push(await sharp({create:{width:tw*5,height:72+th,channels:3,background:'#333'}}).composite(comps).png().toBuffer());
}
for(let p=0;p<Math.ceil(thumbs.length/7);p++){
 const chunk=thumbs.slice(p*7,p*7+7);
 await sharp({create:{width:1300,height:232*chunk.length,channels:3,background:'#fff'}}).composite(chunk.map((input,i)=>({input,left:0,top:i*232}))).png().toFile(join(out,`contact-${p+1}.png`));
}
console.log(JSON.stringify({out,count:report.rows.length}));
