// Frozen unseen-brand regression corpus. No inference, network access or tuning.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const root='test/fixtures/background-removal-fresh-v2';
await mkdir(join(root,'sources'),{recursive:true});
const cached='runs/precision-async-original100-v2/assets';
const specs=[
 ['tiktok','public/assets/game/logos/tiktok.svg',112,112,'curved monochrome silhouette and narrow joint'],
 ['youtube','public/assets/game/logos/youtube.svg',160,112,'interior play detail'],
 ['pinterest','public/assets/game/logos/pinterest.svg',96,96,'curved thin detail'],
 ['spotify','public/assets/game/logos/spotify.svg',40,40,'tiny interior curved lines'],
 ['x','public/assets/game/logos/x.svg',96,96,'thin diagonal strokes'],
 ['curiominds',`${cached}/43052ddeca862e1e40515fa0066d1781e24279dce9414f8be3cca9d4618cf274.svg`,380,100,'detached dots, white brain detail, wide wordmark'],
 ['keyes',`${cached}/2bee85eac22b39605cc313fcbf47c1eafb9def116c898c21aab66aa47d51f9d5.svg`,310,120,'script lettering and detached registered mark'],
 ['avvitell',`${cached}/b045d8a15e2bd5d0a357814655a55b7e2dc138fe40efb7a60d778c3508fb89cf.svg`,380,105,'small subline and white emblem interior'],
 ['curiominds-white',`${cached}/fdbf3cd726b263b08a47d628ebae948037328a72814343f32b65bb8fc1b7a874.svg`,380,100,'white lettering, detached dots, colored interior'],
];
const rows=[];
for(const [index,[brand,source,w,h,challenge]] of specs.entries()){
 const local=join(root,'sources',`${brand}.svg`);
 try{await readFile(local);}catch{await copyFile(source,local);}
 const svg=await readFile(local),sourceSha256=createHash('sha256').update(svg).digest('hex');
 const{data,info}=await sharp(svg).resize(w,h,{fit:'inside'}).ensureAlpha().png().toBuffer({resolveWithObject:true});
 const pad=brand==='spotify'?8:20,width=info.width+pad*2,height=info.height+pad*2;
 const truth=await sharp({create:{width,height,channels:4,background:'#00000000'}}).composite([{input:data,left:pad,top:pad}]).png().toBuffer();
 const truthName=`v2-${brand}-truth.png`;await writeFile(join(root,truthName),truth);
 const variants=brand.endsWith('-white')?[['dark','#142339',false],['dark-jpeg','#343840',true]]:index%2===0?[['white','#ffffff',false],['yellow-jpeg','#fff0cc',true]]:[['gray','#e4eaf2',false],['white-jpeg','#ffffff',true]];
 for(const [variant,bg,jpeg]of variants){
  const id=`v2-${brand}-${variant}`,file=id+(jpeg?'.jpg':'.png');
  const flat=sharp(truth).flatten({background:bg});
  await(jpeg?flat.jpeg({quality:82,chromaSubsampling:'4:2:0'}):flat.png()).toFile(join(root,file));
  rows.push({id,brand,file,truth:truthName,width,height,bg,format:jpeg?'jpeg':'png',jpegQuality:jpeg?82:null,split:'fresh-heldout',challenge,source:`sources/${brand}.svg`,originalSource:source,sourceSha256});
 }
}
await writeFile(join(root,'manifest.json'),JSON.stringify(rows,null,2)+'\n');
console.log(JSON.stringify({cases:rows.length,brands:new Set(rows.map(r=>r.brand.replace('-white',''))).size,root}));
