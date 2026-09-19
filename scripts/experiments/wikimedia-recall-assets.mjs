#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { internals as extractor } from '../../src/extractor.mjs';
import { rankCandidates } from '../../src/rank.mjs';

const args = process.argv.slice(2);
const option = key => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
const controlPath = option('--control'), treatmentPath = option('--treatment'), output = option('--output');
if (!controlPath || !treatmentPath || !output) throw new Error('Required: --control report.json --treatment report.json --output directory');
const read = path => readFile(resolve(path), 'utf8').then(JSON.parse);
const control = await read(controlPath), treatment = await read(treatmentPath);
const previous = new Map(control.rows.map(row => [row.id, row.candidates.map(c => c.url)]));
const root = resolve(output);
await mkdir(root, { recursive: true });
const results = [], panels = [];
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
for (const row of treatment.rows) {
  for (const candidate of row.candidates.filter(c => !(previous.get(row.id) ?? []).includes(c.url))) {
    const validated = await extractor.validateCandidate(candidate, 10000, { requests: 0, bytesDownloaded: 0 });
    const ranked = rankCandidates(validated ? [validated] : [], { preferences: { logo: { theme: 'light' }, icon: { theme: 'light' } } });
    const result = { id: row.id, name: row.name, url: candidate.url, filename: candidate.evidence.commons_filename,
      validated: Boolean(validated), selectedRoles: ['icon', 'wide'].filter(role => ranked.selectedByRole[role]),
      evidence: candidate.evidence, provenance: candidate.provenance,
      ranking: ranked.candidates.map(({ dataUrl, ...record }) => record) };
    results.push(result);
    console.log(JSON.stringify({ id: row.id, validated: result.validated, selectedRoles: result.selectedRoles }));
    if (!validated) continue;
    const bytes = Buffer.from(validated.dataUrl.split(',')[1], 'base64');
    const filename = `${row.id}.${validated.format}`;
    await writeFile(resolve(root, filename), bytes);
    const logo = await sharp(bytes, { density: 192 }).resize(340, 100, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).png().toBuffer();
    const label = Buffer.from(`<svg width="380" height="40"><text x="15" y="25" font-size="17" fill="#111">${escape(row.name)}</text></svg>`);
    const panel = await sharp({ create: { width: 380, height: 160, channels: 4, background: '#ffffff' } }).composite([{ input: label, top: 0, left: 0 }, { input: logo, top: 45, left: 20 }]).png().toBuffer();
    panels.push(panel);
  }
}
if (panels.length) {
  const cols = Math.min(3, panels.length);
  await sharp({ create: { width: cols * 380, height: Math.ceil(panels.length / cols) * 160, channels: 4, background: '#eeeeee' } })
    .composite(panels.map((input, i) => ({ input, left: i % cols * 380, top: Math.floor(i / cols) * 160 }))).png().toFile(resolve(root, 'review.png'));
}
await writeFile(resolve(root, 'results.json'), JSON.stringify({ control: resolve(controlPath), treatment: resolve(treatmentPath), results }, null, 2) + '\n');
