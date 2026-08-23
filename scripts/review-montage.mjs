#!/usr/bin/env node

import { mkdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import sharp from 'sharp';

const runDirectory = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: node scripts/review-montage.mjs <run-directory>');
const results = (await readFile(join(runDirectory, 'results.jsonl'), 'utf8')).trim().split(/\n/).filter(Boolean).map(JSON.parse);
const outputDirectory = join(runDirectory, 'review-montages');
await mkdir(outputDirectory, { recursive: true });

const xml = value => String(value ?? '').replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]);

async function preview(candidate, width) {
  if (!candidate?.asset_path) return null;
  try {
    return await sharp(join(runDirectory, candidate.asset_path), { density: 144, limitInputPixels: 40_000_000, animated: false })
      .resize({ width: width - 24, height: 58, fit: 'contain', withoutEnlargement: true }).png().toBuffer();
  } catch { return null; }
}

function selected(result, role) {
  const id = result.selected_by_role?.[role];
  return result.candidates?.find(candidate => candidate.candidate_id === id) ?? null;
}

for (let offset = 0; offset < results.length; offset += 10) {
  const page = results.slice(offset, offset + 10);
  const width = 1200, rowHeight = 180, height = rowHeight * page.length;
  const layers = [];
  for (let index = 0; index < page.length; index++) {
    const result = page[index], y = index * rowHeight;
    const icon = selected(result, 'icon'), wide = selected(result, 'wide');
    const label = `<svg width="280" height="180" xmlns="http://www.w3.org/2000/svg"><rect width="280" height="180" fill="#f4f6f8"/><text x="14" y="28" font-family="Arial" font-weight="700" font-size="17" fill="#111827">${xml(`${offset + index + 1}. ${result.name}`)}</text><text x="14" y="51" font-family="Arial" font-size="13" fill="#4b5563">${xml(result.website)}</text><text x="14" y="75" font-family="Arial" font-size="12" fill="#6b7280">${xml(result.reachability)}</text><text x="14" y="112" font-family="Arial" font-size="12" fill="#374151">ICON: ${xml(icon ? `${icon.source} ${icon.width ?? '?'}×${icon.height ?? '?'}` : '—')}</text><text x="14" y="139" font-family="Arial" font-size="12" fill="#374151">WIDE: ${xml(wide ? `${wide.source} ${wide.width ?? '?'}×${wide.height ?? '?'}` : '—')}</text></svg>`;
    layers.push({ input: Buffer.from(label), left: 0, top: y });
    for (const [candidate, left, panelWidth] of [[icon, 290, 320], [wide, 620, 570]]) {
      layers.push({ input: { create: { width: panelWidth, height: 84, channels: 4, background: '#ffffff' } }, left, top: y + 4 });
      layers.push({ input: { create: { width: panelWidth, height: 84, channels: 4, background: '#15191f' } }, left, top: y + 92 });
      const rendered = await preview(candidate, panelWidth);
      if (rendered) {
        const metadata = await sharp(rendered).metadata();
        const imageLeft = left + Math.floor((panelWidth - metadata.width) / 2);
        layers.push({ input: rendered, left: imageLeft, top: y + 17 });
        layers.push({ input: rendered, left: imageLeft, top: y + 105 });
      }
    }
  }
  const filename = join(outputDirectory, `page-${String(Math.floor(offset / 10) + 1).padStart(2, '0')}.png`);
  await sharp({ create: { width, height, channels: 4, background: '#d9dde3' } }).composite(layers).png().toFile(filename);
  process.stdout.write(`${filename}\n`);
}

process.stdout.write(`${results.length} results from ${basename(runDirectory)}\n`);
