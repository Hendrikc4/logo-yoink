// Independent visual inspection only. Never runs inference.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const root='runs/background-removal-v2',out=join(root,'fresh-visual');
await mkdir(out,{recursive:true});
const rows=JSON.parse(await readFile(join(root,'results.json'))).rows.slice(42);
const evidence=[];
for(const [index,r]of rows.entries()){
 const files=await Promise.all([join(r.root,r.file),join(r.root,r.truth),join(root,`${r.id}-returned.png`)].map(p=>readFile(p)));
 const {width:w,height:h}=await sharp(files[0]).metadata();
 for(const scale of [1,4]){
  const cw=Math.max(w*scale,260),ch=h*scale,comps=[];
  for(let c=0;c<3;c++){
   const label=['Original','Known alpha reference',`Returned: ${r.applied?'processed':'retained'}`][c];
   comps.push({input:Buffer.from(`<svg width="${cw}" height="36"><rect width="100%" height="100%" fill="#eee"/><text x="8" y="23" font-size="13">${index+1}. ${label}</text></svg>`),left:c*cw,top:0});
   for(let b=0;b<3;b++){
    const bg=b===0?'#fff':b===1?'#000':'url(#c)',s=8*scale;
    const svg=Buffer.from(`<svg width="${cw}" height="${ch}"><defs><pattern id="c" width="${s*2}" height="${s*2}" patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="#eee"/><path d="M0 0h${s}v${s}H0zM${s} ${s}h${s}v${s}H${s}z" fill="#aaa"/></pattern></defs><rect width="100%" height="100%" fill="${bg}"/></svg>`);
    const im=await sharp(files[c]).resize(w*scale,h*scale,{kernel:'nearest'}).png().toBuffer();
    comps.push({input:await sharp(svg).composite([{input:im,left:Math.floor((cw-w*scale)/2),top:0}]).png().toBuffer(),left:c*cw,top:36+b*ch});
   }
  }
  await sharp({create:{width:cw*3,height:36+ch*3,channels:3,background:'#fff'}}).composite(comps).png().toFile(join(out,`${index+1}-${scale}x.png`));
 }
 evidence.push({number:index+1,id:r.id,applied:r.applied,reason:r.reason,method:r.method,metrics:r.metrics,returnedSha256:createHash('sha256').update(files[2]).digest('hex')});
}
await writeFile(join(out,'evidence.json'),JSON.stringify(evidence,null,2));
console.log({count:rows.length,out});
