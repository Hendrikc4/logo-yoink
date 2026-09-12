import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const repo = '/Users/hendrik/Documents/logo-yoink';
const out = path.dirname(new URL(import.meta.url).pathname);
const cache = path.join(homedir(), '.cache/logo-yoink/background-removal/experiments');
const readJson = async p => JSON.parse(await fs.readFile(p, 'utf8'));
if (process.argv.includes('--all42')) { await buildAll42(); process.exit(0); }
const results = await readJson(path.join(repo, 'docs/background-removal-quality/production-refined.json'));
const corpus = await readJson(path.join(repo, 'test/fixtures/background-removal/manifest.json'));
const fresh = await readJson(path.join(repo, 'runs/background-removal-independent/results.json'));
const measured = await readJson(path.join(repo, 'docs/background-removal-quality/production.json'));
const approved = results.filter(r => r.applied);
assert.equal(results.length, 36);
assert.equal(approved.length, 7);
assert.equal(fresh.length, 6);
assert.equal(fresh.filter(r => r.applied).length, 0);

const kinds = {
  thin: 'Thin wordmark', dots: 'Dotted lettering', 'white-detail': 'White interior symbol',
  gradient: 'Gradient mark', tiny: 'Tiny icon', wide: 'Wide wordmark',
  outline: 'Thin outline', disconnected: 'Detached dots',
};
const reasons = {
  'foreground-loss': 'Logo detail could be lost. Original retained.',
  'foreground-component-loss': 'A detached detail could be lost. Original retained.',
  'background-retained': 'Background residue detected. Original retained.',
  'edge-uncertain': 'Edge colors could not be resolved safely. Original retained.',
  'uncertain-background': 'Background was ambiguous. Original retained.',
  'unsafe-mask': 'Mask failed area checks. Original retained.',
};
const samples = [];
for (const result of [...approved, ...['s0-1-thin', 's0-2-thin', 's6-0-outline'].map(id => results.find(r => r.id === id))]) {
  const item = corpus.find(c => c.id === result.id);
  const input = await fs.readFile(path.join(repo, 'test/fixtures/background-removal', item.file));
  const output = await fs.readFile(path.join(cache, `production-refined-${item.id}.png`));
  if (!result.applied) assert.ok(output.equals(input), `${item.id}: original should be preserved`);
  const bg = item.bg === '#ffffff' ? 'White background' : item.bg === '#e7ebf3' ? 'Pale blue background' : 'JPEG on pale yellow';
  samples.push({ id: item.id, name: kinds[item.kind] ?? item.kind, group: `Synthetic\n${bg}`, input, output,
    applied: result.applied, note: result.applied ? 'Background removed with local edge matting. Canonical original retained separately.' : reasons[result.reason] ?? result.reason });
}
for (const item of fresh) {
  const input = await fs.readFile(path.join(repo, 'runs/background-removal-independent', item.file));
  const output = await fs.readFile(path.join(repo, 'runs/background-removal-independent', `${item.name}-result.png`));
  const inputPixels = await sharp(input).ensureAlpha().raw().toBuffer();
  const outputPixels = await sharp(output).ensureAlpha().raw().toBuffer();
  assert.ok(outputPixels.equals(inputPixels), `${item.name}: preview pixels should match the preserved original`);
  const name = { github: 'GitHub', instagram: 'Instagram' }[item.name] ?? item.name[0].toUpperCase() + item.name.slice(1);
  samples.push({ id: item.name, name, group: `Fresh brand logo\n${item.width} × ${item.height} px`, input, output,
    applied: false, note: reasons[item.transformations[0].reason] });
}
assert.equal(samples.length, 16);

const PANEL_W = 248, PANEL_H = 118;
async function panel(bytes, surface) {
  const { data: logo, info } = await sharp(bytes).resize({ width: 228, height: 102, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  const background = Buffer.alloc(PANEL_W * PANEL_H * 3);
  for (let y = 0; y < PANEL_H; y++) for (let x = 0; x < PANEL_W; x++) {
    const rgb = surface === 'dark' ? [20, 24, 32] : surface === 'checker' ? ((Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? [221, 225, 231] : [250, 251, 252]) : [245, 247, 250];
    for (let c = 0; c < 3; c++) background[(y * PANEL_W + x) * 3 + c] = rgb[c];
  }
  return sharp(background, { raw: { width: PANEL_W, height: PANEL_H, channels: 3 } })
    .composite([{ input: logo, left: Math.floor((PANEL_W - info.width) / 2), top: Math.floor((PANEL_H - info.height) / 2) }]).png().toBuffer();
}
for (const s of samples) s.panels = await Promise.all([panel(s.input, 'original'), panel(s.output, 'checker'), panel(s.output, 'dark')]);

const wb = Workbook.create();
const summary = wb.worksheets.add('Executive summary');
const visual = wb.worksheets.add('Logo samples');
const ink = '#172536', accent = '#294967', muted = '#5A6878';
function base(sheet, range) {
  sheet.showGridLines = false;
  sheet.getRange(range).format.font = { name: 'Arial', size: 11, color: ink };
  sheet.getRange(range).format.rowHeightPx = 27;
  sheet.getRange(range).format.verticalAlignment = 'center';
}
function write(sheet, cell, value) { sheet.getRange(cell).values = [[value]]; }
function header(sheet, range) {
  sheet.getRange(range).format.fill = accent;
  sheet.getRange(range).format.font = { name: 'Arial', size: 11, bold: true, color: '#FFFFFF' };
  sheet.getRange(range).format.horizontalAlignment = 'center';
  sheet.getRange(range).format.rowHeightPx = 34;
}
base(summary, 'A1:E35');
summary.tabColor = accent;
for (const [c, width] of Object.entries({ A: 360, B: 125, C: 145, D: 140, E: 145 })) summary.getRange(`${c}1:${c}35`).format.columnWidthPx = width;
summary.getRange('A1:E1').format.rowHeightPx = 16;
write(summary, 'A2', 'Local background removal');
summary.getRange('A2').format.font = { name: 'Arial', size: 17, bold: true, color: ink };
summary.getRange('A2:E2').format.rowHeightPx = 35;
summary.getRange('A3:E3').format.borders = { bottom: { style: 'thin', color: '#BCC9D6' } };
write(summary, 'A3', 'Executive summary. Evidence from 8 September 2026.');
summary.getRange('A3').format.font.color = muted;
write(summary, 'A5', 'Implemented and tested. Keep optional because coverage is limited and RAM use is high.');
summary.getRange('A5').format.font.bold = true;
write(summary, 'A6', 'Local installs only. Disabled by default. The hosted website has no background-removal control.');
write(summary, 'A8', 'Observed coverage');
summary.getRange('A8').format.font.bold = true;
summary.getRange('A9:E11').values = [
  ['Test group', 'Inputs', 'Processed', 'Preserved', 'Applied rate'],
  ['Diagnostic corpus', results.length, approved.length, null, null],
  ['Fresh independent logos', fresh.length, fresh.filter(r => r.applied).length, null, null],
];
header(summary, 'A9:E9');
for (const r of [10, 11]) {
  summary.getRange(`D${r}:E${r}`).formulas = [[`=B${r}-C${r}`, `=C${r}/B${r}`]];
}
write(summary, 'A12', 'Combined observed results');
summary.getRange('B12:E12').formulas = [['=SUM(B10:B11)', '=SUM(C10:C11)', '=SUM(D10:D11)', '=C12/B12']];
summary.getRange('A12:E12').format.fill = '#EDF2F7';
summary.getRange('A12:E12').format.font.bold = true;
summary.getRange('B10:D12').setNumberFormat('#,##0');
summary.getRange('E10:E12').setNumberFormat('0.0%');
summary.getRange('B10:E12').format.horizontalAlignment = 'right';
write(summary, 'A14', 'The fresh six all kept their original backgrounds. This demonstrates safe refusal, not successful removal.');
write(summary, 'A15', 'The diagnostic set informed tuning. The combined rate is descriptive, not a general success-rate estimate.');
summary.getRange('A14:A15').format.font.color = '#815218';
write(summary, 'A17', 'Implementation and operating cost');
summary.getRange('A17').format.font.bold = true;
const meanMs = measured.reduce((a, r) => a + r.ms, 0) / measured.length;
const peakMiB = Math.max(...measured.map(r => r.rssMB));
summary.getRange('A18:B24').values = [
  ['Model', 'BiRefNet Lite FP32'],
  ['Processing', 'CPU, 1024 × 1024, soft mask and local edge matting'],
  ['Scope and default', 'Local only, off by default'],
  ['Mean processing time', meanMs / 1000],
  ['Peak resident memory', peakMiB],
  ['Recommended machine', '16 GB RAM or more'],
  ['Automated verification', 346],
];
write(summary, 'C21', 'seconds per image');
write(summary, 'C22', 'MiB RSS (roughly 9 GB)');
write(summary, 'C24', 'tests passed');
summary.getRange('B21').setNumberFormat('0.00');
summary.getRange('B22').setNumberFormat('#,##0');
summary.getRange('B24').setNumberFormat('#,##0');
write(summary, 'A26', 'Quality assessment');
summary.getRange('A26').format.font.bold = true;
write(summary, 'A27', 'Edge matting removed the visible pale halos in the accepted examples while preserving lettering and dots.');
write(summary, 'A28', 'JPEG edges, thin outlines, ambiguous backgrounds and common black icons are often declined.');
write(summary, 'A29', 'Prioritize broader useful coverage and lower RAM requirements before considering default-on use.');
write(summary, 'A32', 'Evidence');
summary.getRange('A32').format.font.bold = true;
write(summary, 'A33', 'Sources: Local background-removal quality experiment and Independent background-removal QA, 8 Sep 2026.');
write(summary, 'A34', '36-case final production replay, six-case worker run, and the completed npm run check.');
write(summary, 'A35', 'The image tab is a selected visual review. It is not representative of the overall success rate.');
summary.getRange('A33:A35').format.font = { name: 'Arial', size: 10, color: muted };

base(visual, 'A1:F22');
visual.tabColor = '#526E88';
for (const [c, width] of Object.entries({ A: 195, B: 268, C: 268, D: 268, E: 145, F: 250 })) visual.getRange(`${c}1:${c}22`).format.columnWidthPx = width;
visual.getRange('A1:F1').format.rowHeightPx = 16;
write(visual, 'A2', 'Logo samples');
visual.getRange('A2').format.font = { name: 'Arial', size: 17, bold: true, color: ink };
visual.getRange('A2:F2').format.rowHeightPx = 35;
write(visual, 'A3', 'All seven accepted examples, three declined diagnostics, and six fresh brand logos.');
write(visual, 'A4', 'Images fit the panels without enlargement. Preserved results still contain their original background.');
visual.getRange('A3:A4').format.font.color = muted;
visual.getRange('A5:F5').format.rowHeightPx = 12;
visual.getRange('A6:F6').values = [['Logo / test case', 'Original input', 'Returned on checkerboard', 'Returned on black', 'Outcome', 'Review note']];
header(visual, 'A6:F6');
for (const [i, s] of samples.entries()) {
  const r = i + 7;
  visual.getRange(`A${r}:F${r}`).format.rowHeightPx = 144;
  visual.getRange(`A${r}:F${r}`).format.borders = { bottom: { style: 'thin', color: '#E1E6EC' } };
  write(visual, `A${r}`, `${s.name}\n${s.group}`);
  write(visual, `E${r}`, s.applied ? 'Processed' : 'Original retained');
  write(visual, `F${r}`, s.note);
  visual.getRange(`A${r}`).format.wrapText = true;
  visual.getRange(`E${r}:F${r}`).format.wrapText = true;
  visual.getRange(`E${r}`).format.font = { name: 'Arial', size: 11, bold: true, color: s.applied ? '#14634E' : '#815218' };
  for (let c = 0; c < 3; c++) visual.images.add({
    dataUrl: `data:image/png;base64,${s.panels[c].toString('base64')}`,
    anchor: { from: { row: r - 1, col: c + 1, rowOffsetPx: 13, colOffsetPx: 10 }, extent: { widthPx: PANEL_W, heightPx: PANEL_H } },
  });
}
visual.freezePanes.freezeRows(6);
wb.recalculate();
console.log((await wb.inspect({ kind: 'table', range: "'Executive summary'!A9:E12", include: 'values,formulas', tableMaxRows: 4, tableMaxCols: 5 })).ndjson);
console.log((await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 20 }, summary: 'Final formula scan' })).ndjson);
for (const [name, range, file] of [
  ['Executive summary', 'A1:E35', 'summary-preview.png'],
  ['Logo samples', 'A1:F10', 'samples-preview.png'],
  ['Logo samples', 'A17:F22', 'fresh-samples-preview.png'],
]) {
  const render = await wb.render({ sheetName: name, range, scale: 1, format: 'png' });
  await fs.writeFile(path.join(out, file), new Uint8Array(await render.arrayBuffer()));
}
await (await SpreadsheetFile.exportXlsx(wb)).save(path.join(out, 'logo-background-removal-review.xlsx'));

// Standalone visual sheet, using the same saved results and panel pixels as the workbook.
const selected = ['s0-0-thin', 's1-0-dots', 's2-0-white-detail', 's3-0-gradient', 's7-0-disconnected', 'apple', 'google'].map(id => samples.find(s => s.id === id));
const xml = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const width = 1104, rowH = 144, top = 140, height = top + selected.length * rowH + 30;
const labels = [
  `<text x="24" y="36" font-size="24" font-weight="700">Logo background removal</text>`,
  `<text x="24" y="65" font-size="15" fill="#536174">Selected examples. Final local model output. Test date: 8 September 2026.</text>`,
  `<text x="24" y="88" font-size="14" fill="#815218">Across all 42 tests: 7 processed, 35 preserved. These examples show both outcomes.</text>`,
  ...['Test case', 'Original input', 'Returned on checkerboard', 'Returned on black'].map((s, i) => `<text x="${[24, 248, 528, 808][i]}" y="124" font-size="14" font-weight="700">${s}</text>`),
];
const layers = [];
for (const [i, s] of selected.entries()) {
  const y = top + i * rowH;
  labels.push(`<line x1="24" y1="${y + rowH - 6}" x2="1080" y2="${y + rowH - 6}" stroke="#DBE3EB"/>`);
  labels.push(`<text x="24" y="${y + 32}" font-size="16" font-weight="700">${xml(s.name)}</text>`);
  labels.push(`<text x="24" y="${y + 58}" font-size="14" fill="${s.applied ? '#14634E' : '#815218'}">${s.applied ? 'Background removed' : 'Original retained'}</text>`);
  labels.push(`<text x="24" y="${y + 82}" font-size="13" fill="#536174">${s.applied ? 'Synthetic test logo' : 'Fresh brand test'}</text>`);
  for (let j = 0; j < 3; j++) layers.push({ input: s.panels[j], left: [248, 528, 808][j], top: y + 4 });
}
const textLayer = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g font-family="Arial" fill="#172536">${labels.join('')}</g></svg>`);
await sharp({ create: { width, height, channels: 3, background: '#FFFFFF' } }).composite([...layers, { input: textLayer, top: 0, left: 0 }]).png().toFile(path.join(out, 'logo-before-after-sheet.png'));
console.log(JSON.stringify({ workbook: 'logo-background-removal-review.xlsx', visualSheet: 'logo-before-after-sheet.png', samples: samples.length, mainCases: results.length, freshCases: fresh.length, processed: approved.length, meanSeconds: meanMs / 1000, peakMiB }));

async function buildAll42() {
  const auditRoot = path.join(repo, 'runs/background-removal-all-42');
  const audit = await readJson(path.join(auditRoot, 'results.json'));
  assert.equal(audit.rows.length, 42);
  const qa = (await Promise.all(['first21', 'last21'].map(s => readJson(path.join(repo, `docs/background-removal-all-42-${s}.json`))))).flatMap(r => r.rows ?? r.cases ?? r);
  const book = Workbook.create(), summary = book.worksheets.add('Executive summary'), sheet = book.worksheets.add('All 42 logos');
  const ink = '#172536', accent = '#294967';
  for (const [s, range] of [[summary, 'A1:E25'], [sheet, 'A1:I48']]) {
    s.showGridLines = false;
    s.getRange(range).format.font = { name: 'Arial', size: 11, color: ink };
    s.getRange(range).format.rowHeightPx = 28;
    s.getRange(range).format.verticalAlignment = 'center';
  }
  const put = (s, c, v) => { s.getRange(c).values = [[v]]; };
  const hdr = (s, r) => { s.getRange(r).format.fill = accent; s.getRange(r).format.font = { name: 'Arial', size: 11, bold: true, color: '#fff' }; s.getRange(r).format.rowHeightPx = 36; s.getRange(r).format.horizontalAlignment = 'center'; };
  for (const [c,w] of Object.entries({A:340,B:135,C:135,D:140,E:150})) summary.getRange(`${c}1:${c}25`).format.columnWidthPx = w;
  put(summary,'A2','All 42 background-removal results'); summary.getRange('A2').format.font.size=17;
  put(summary,'A3','Every model prediction was inspected, including rejected outputs.');
  summary.getRange('A3:E3').format.borders={bottom:{style:'thin',color:'#BCC9D6'}};
  summary.getRange('A5:E8').values=[['Test group','Inputs','Processed','Preserved','Applied rate'],['Diagnostic corpus',36,null,null,null],['Fresh brand logos',6,null,null,null],['Combined',null,null,null,null]];
  hdr(summary,'A5:E5');
  summary.getRange('C6:E6').formulas=[[`=COUNTIFS('All 42 logos'!G7:G42,"Processed")`,'=B6-C6','=C6/B6']];
  summary.getRange('C7:E7').formulas=[[`=COUNTIFS('All 42 logos'!G43:G48,"Processed")`,'=B7-C7','=C7/B7']];
  summary.getRange('B8:E8').formulas=[['=SUM(B6:B7)','=SUM(C6:C7)','=SUM(D6:D7)','=C8/B8']];
  summary.getRange('E6:E8').setNumberFormat('0.0%'); summary.getRange('B6:D8').setNumberFormat('0');
  summary.getRange('A8:E8').format.font.bold=true;
  put(summary,'A10','A retained original is a failed or declined removal, not a successful transparent logo.');
  put(summary,'A11','Raw predictions are diagnostic only. The returned column shows what the user receives.');
  put(summary,'A13','Model'); put(summary,'B13','BiRefNet Lite 512 FP32');
  put(summary,'A14','Execution'); put(summary,'B14','Local CPU, explicit setup, disabled by default');
  put(summary,'A16','Visual review'); put(summary,'B16','All 42, white / black / checkerboard, native size and 4×');
  put(summary,'A18','Observed problems');
  put(summary,'A19','Rejected predictions include missing lettering or dots, altered white details, halos and retained background.');
  put(summary,'A20','The diagnostic corpus informed tuning. This is an observed outcome count, not a general accuracy estimate.');
  put(summary,'A22','Sources');
  put(summary,'A23','Local all-42 prediction replay and two independent case-by-case visual reviews, September 2026.');
  put(summary,'A24',`${audit.rows.filter(r=>r.truth).length} cases have an alpha reference. One cached example has no alpha reference.`);
  for(const [c,w] of Object.entries({A:190,B:248,C:248,D:248,E:248,F:248,G:150,H:22,I:450})) sheet.getRange(`${c}1:${c}48`).format.columnWidthPx=w;
  put(sheet,'A2','All 42 logo comparisons'); sheet.getRange('A2').format.font.size=17;
  put(sheet,'A3','Raw predictions are diagnostic and may contain severe defects. Returned results preserve originals when declined.');
  put(sheet,'A4','Thumbnails fit without enlargement. Detailed native and 4× comparison boards accompany the audit.');
  sheet.getRange('A6:G6').values=[['Case / cohort','Original input','Alpha reference','Raw diagnostic on black','Returned on checkerboard','Returned on black','Final outcome']];
  hdr(sheet,'A6:G6'); put(sheet,'I6','Visual review notes');
  const width=228,height=118;
  async function thumbnail(bytes,surface) {
    const {data,info}=await sharp(bytes).resize({width:216,height:106,fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
    const bg=Buffer.alloc(width*height*3);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const v=surface==='black'?16:surface==='checker'?((Math.floor(x/10)+Math.floor(y/10))%2?212:248):248;
      bg.fill(v,(y*width+x)*3,(y*width+x)*3+3);
    }
    return sharp(bg,{raw:{width,height,channels:3}}).composite([{input:data,left:Math.floor((width-info.width)/2),top:Math.floor((height-info.height)/2)}]).png().toBuffer();
  }
  for(const [i,r] of audit.rows.entries()) {
    const row=i+7, q=qa.find(x=>x.id===r.id); assert.ok(q,`Missing review ${r.id}`);
    const input=await fs.readFile(path.join(repo,r.root,r.file)), raw=await fs.readFile(path.join(auditRoot,`${r.id}-raw.png`)), returned=await fs.readFile(path.join(auditRoot,`${r.id}-returned.png`));
    const truth=r.truth?await fs.readFile(path.join(repo,r.root,r.truth)):null;
    if(!r.applied) assert.ok((await sharp(input).ensureAlpha().raw().toBuffer()).equals(await sharp(returned).ensureAlpha().raw().toBuffer()),`Returned original changed ${r.id}`);
    sheet.getRange(`A${row}:I${row}`).format.rowHeightPx=152;
    sheet.getRange(`A${row}:G${row}`).format.borders={bottom:{style:'thin',color:'#E1E6EC'}};
    put(sheet,`A${row}`,`${r.number}. ${r.id}\n${r.number>36?'Fresh brand':r.number<=24?'Synthetic reference':'Cached real asset'}`);
    put(sheet,`G${row}`,r.applied?'Processed':'Original retained');
    let note=q.note??q.notes??q.findings??q.verdict; if(Array.isArray(note)) note=note.join(' '); if(typeof note!=='string') note=JSON.stringify(note);
    if(q.applied!==undefined&&q.applied!==r.applied) note=`Updated replay: ${r.applied?'processed':'original retained'}. Earlier review: ${note}`;
    put(sheet,`I${row}`,note);
    sheet.getRange(`A${row}`).format.wrapText=true;sheet.getRange(`G${row}`).format.wrapText=true;sheet.getRange(`I${row}`).format.wrapText=true;
    sheet.getRange(`G${row}`).format.font.color=r.applied?'#14634E':'#815218';
    const panels=[await thumbnail(input,'white'),truth?await thumbnail(truth,'black'):null,await thumbnail(raw,'black'),await thumbnail(returned,'checker'),await thumbnail(returned,'black')];
    for(const [c,p]of panels.entries()) if(p) sheet.images.add({dataUrl:`data:image/png;base64,${p.toString('base64')}`,anchor:{from:{row:row-1,col:c+1,rowOffsetPx:17,colOffsetPx:10},extent:{widthPx:width,heightPx:height}}}); else put(sheet,`C${row}`,'No alpha reference');
  }
  sheet.freezePanes.freezeRows(6);
  book.recalculate();
  console.log((await book.inspect({kind:'table',range:"'Executive summary'!A5:E8",include:'values,formulas',tableMaxRows:4,tableMaxCols:5})).ndjson);
  console.log((await book.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!',options:{useRegex:true,maxResults:20}})).ndjson);
  for(const [s,r,f]of [['Executive summary','A1:E24','all42-summary-preview.png'],['All 42 logos','A43:I48','all42-lastrows-preview.png']]) {
    const p=await book.render({sheetName:s,range:r,scale:1,format:'png'});await fs.writeFile(path.join(out,f),new Uint8Array(await p.arrayBuffer()));
  }
  await(await SpreadsheetFile.exportXlsx(book)).save(path.join(out,'logo-all-42-review.xlsx'));
  console.log(JSON.stringify({rows:42,processed:audit.rows.filter(r=>r.applied).length,images:168+audit.rows.filter(r=>r.truth).length}));
}
