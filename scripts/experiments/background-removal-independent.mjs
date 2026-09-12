import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { processAsset } from '../../src/post-process.mjs';
const root = new URL('../../runs/background-removal-independent/', import.meta.url);
await mkdir(root, { recursive: true });
const choices = [
  ['apple', 96, '#ffffff', 'png'],
  ['figma', 160, '#edf1f6', 'png'],
  ['github', 80, '#fff0cc', 'jpeg'],
  ['google', 240, '#ffffff', 'png'],
  ['instagram', 32, '#edf1f6', 'jpeg'],
  ['notion', 128, '#ffffff', 'png'],
];
if (process.argv.includes('--prepare')) {
  const fixtures = [];
  for (const [name, size, background, format] of choices) {
    const source = `public/assets/game/logos/${name}.svg`;
    const svg = await readFile(source);
    const margin = Math.max(4, Math.round(size / 8));
    const truth = await sharp(svg).resize(size, size, { fit: 'contain', background: '#00000000' })
      .extend({ top: margin, bottom: margin, left: margin, right: margin, background: '#00000000' }).ensureAlpha().png().toBuffer();
    const input = await sharp(truth).flatten({ background })[format](format === 'jpeg' ? { quality: 80 } : {}).toBuffer();
    const file = `${name}.${format === 'jpeg' ? 'jpg' : 'png'}`;
    await writeFile(new URL(file, root), input);
    await writeFile(new URL(`${name}-truth.png`, root), truth);
    fixtures.push({ name, source, sourceSha256: createHash('sha256').update(svg).digest('hex'), file, truth: `${name}-truth.png`, size, background, format });
  }
  await writeFile(new URL('fixtures.json', root), JSON.stringify(fixtures, null, 2));
  process.exit(0);
}
const results = [];
for (const fixture of JSON.parse(await readFile(new URL('fixtures.json', root)))) {
  const bytes = await readFile(new URL(fixture.file, root));
  const metadata = await sharp(bytes).metadata();
  const original = { resolvedUrl: `https://fixture.invalid/${fixture.file}`, format: fixture.format, width: metadata.width, height: metadata.height,
    dataUrl: `data:image/${fixture.format};base64,${bytes.toString('base64')}`, scalable: false };
  const started = performance.now();
  const result = await processAsset(original, { removeBackground: true });
  const ms = performance.now() - started;
  const output = result.enhanced ? Buffer.from(result.enhanced.dataUrl.split(',')[1], 'base64') : bytes;
  await sharp(output).png().toFile(new URL(`${fixture.name}-result.png`, root).pathname);
  const raw = await sharp(output).ensureAlpha().raw().toBuffer();
  const truth = await sharp(new URL(fixture.truth, root).pathname).ensureAlpha().raw().toBuffer();
  let fg = 0, loss = 0, bg = 0, residue = 0;
  for (let i = 3; i < truth.length; i += 4) {
    if (truth[i] === 255) { fg++; loss += 1 - raw[i] / 255; }
    if (truth[i] === 0) { bg++; residue += raw[i] / 255; }
  }
  const row = { ...fixture, width: metadata.width, height: metadata.height, applied: !!result.enhanced, transformations: result.transformations,
    ms: Math.round(ms), foregroundLoss: loss / fg, remainingBackground: residue / bg, canonicalPreserved: result.original === original && original.dataUrl.endsWith(bytes.toString('base64')) };
  results.push(row);
  console.log(JSON.stringify(row));
  await writeFile(new URL('results.json', root), JSON.stringify(results, null, 2));
}
