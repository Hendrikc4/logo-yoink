// Independent visual QA only; no model initialization or inference.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
const cache = join(homedir(), '.cache/logo-yoink/background-removal/experiments');
const variant = process.env.QA_VARIANT || 'birefnet-512';
const candidate = join(cache, variant + '-performance');
const report = JSON.parse(await readFile(join(candidate, 'results.json')));
const old = JSON.parse(await readFile('docs/background-removal-quality/production-refined.json'));
const manifest = JSON.parse(await readFile('test/fixtures/background-removal/manifest.json')).map(x => ({ ...x, root: 'test/fixtures/background-removal' }));
const fresh = JSON.parse(await readFile('test/fixtures/background-removal-independent/results.json')).map(x => ({ ...x, id: 'fresh-' + x.name, root: 'test/fixtures/background-removal-independent' }));
const out = join('runs', variant + '-visual-qa');
await mkdir(out, { recursive: true });
const ids = new Set([...old.filter(x => x.applied).map(x => x.id), ...report.rows.filter(x => x.applied).map(x => x.id)]);
const escape = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;');
const rows = [];
for (const id of ids) {
 const item = [...manifest, ...fresh].find(x => x.id === id);
 const r = report.rows.find(x => x.id === id);
 if (!r) continue;
 const input = await readFile(join(item.root, item.file));
 const truth = item.truth ? await readFile(join(item.root, item.truth)) : input;
 const previous = id.startsWith('fresh-') ? input : await readFile(join(cache, 'production-refined-' + id + '.png'));
 const next = await readFile(join(candidate, id + '.png'));
 const { width:w,height:h } = await sharp(input).metadata();
 for(const scale of [1,4]) {
  const cw = Math.max(w*scale, 220), ch=h*scale, header=40;
  const composites=[];
  const labels = ['Original', 'Reference alpha', 'Previous 1024', `Candidate ${report.size} (${r.applied?'applied':'retained'})`];
  for(let col=0;col<4;col++) {
   composites.push({ input:Buffer.from(`<svg width="${cw}" height="${header}"><rect width="100%" height="100%" fill="#e3e9f0"/><text x="8" y="25" font-family="Arial" font-size="13">${escape(labels[col])}</text></svg>`),left:col*cw,top:0});
   for(let row=0;row<3;row++) {
    const bg = row===0?'#000000':row===2?'#ffffff':'url(#c)';
    const svg=Buffer.from(`<svg width="${cw}" height="${ch}"><defs><pattern id="c" width="${16*scale}" height="${16*scale}" patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="#eee"/><path d="M0 0h${8*scale}v${8*scale}H0zM${8*scale} ${8*scale}h${8*scale}v${8*scale}H${8*scale}z" fill="#aaa"/></pattern></defs><rect width="100%" height="100%" fill="${bg}"/></svg>`);
    const resized=await sharp([input,truth,previous,next][col]).resize(w*scale,h*scale,{kernel:'nearest'}).png().toBuffer();
    const panel=await sharp(svg).composite([{input:resized,left:Math.floor((cw-w*scale)/2),top:0}]).png().toBuffer();
    composites.push({input:panel,left:col*cw,top:header+row*ch});
   }
  }
  await sharp({create:{width:cw*4,height:header+ch*3,channels:3,background:'#fff'}}).composite(composites).png().toFile(join(out,`${id}-${scale}x.png`));
 }
 rows.push({id,oldApplied:old.find(x=>x.id===id)?.applied??false,candidateApplied:r.applied,metrics:r.metrics});
}
await writeFile(join(out,'comparison.json'),JSON.stringify(rows,null,2));
console.log(JSON.stringify({out,rows},null,2));
