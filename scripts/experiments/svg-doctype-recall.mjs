#!/usr/bin/env node
// Paired, offline SVG experiment. No library files or frozen fixtures are changed.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { normalizeLegacySvgDoctype } from '../../src/standalone-svg.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const output = resolve(option('--output', 'runs/missing-logo-program-2026-09-19/svg'));
const baselinePath = resolve(option('--baseline-src', 'runs/missing-logo-program-2026-09-19/baseline/src'));
const { internals: baseline } = await import(pathToFileURL(resolve(baselinePath, 'extractor.mjs')));
const { rankCandidates } = await import(pathToFileURL(resolve(baselinePath, 'rank.mjs')));
const manifestPath = resolve(option('--manifest', 'brand-library/v2/manifest.json'));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const inputs = [], seen = new Set();
for (const brand of manifest.brands) {
  for (const asset of [...Object.values(brand.assets ?? {}), ...Object.values(brand.variants ?? {}).flat()]) {
    if (!asset?.path) continue;
    const path = resolve(dirname(manifestPath), asset.path);
    if (seen.has(path)) continue;
    seen.add(path);
    inputs.push({ id: brand.id, path, cohort: 'approved-library-control', candidate: {
      url: asset.sourceUrl, source: asset.sourceKind, declared: { width: asset.width, height: asset.height },
      evidence: { positive_token: true },
    } });
  }
}
const candidateInputs = option('--candidate-inputs');
if (candidateInputs) inputs.push(...JSON.parse(await readFile(resolve(candidateInputs), 'utf8')));
const capturedRows = option('--captured-rows');
const captures = option('--captures', 'runs/missing-logo-program-2026-09-19/captures');
if (capturedRows) {
  for (const filename of (await readdir(resolve(capturedRows))).filter(name => name.endsWith('.json')).sort()) {
    const row = JSON.parse(await readFile(resolve(capturedRows, filename), 'utf8'));
    // Holdout must stay hidden while this experiment is being tuned.
    if (row.split !== 'development') continue;
    for (const candidate of row.candidates ?? []) {
      const path = resolve(captures, `${sha256(candidate.url)}.json`);
      try {
        const capture = JSON.parse(await readFile(path, 'utf8'));
        if (capture.status !== 200) continue;
        inputs.push({ id: row.id, cohort: 'development-missing', path, candidate, bytes: Buffer.from(capture.body, 'base64') });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}
await mkdir(output, { recursive: true });
const rows = [], panels = [];
for (const input of inputs) {
  const original = input.bytes ?? await readFile(input.path);
  const control = await baseline.validateCandidateBytes(input.candidate, original);
  const normalized = normalizeLegacySvgDoctype(original);
  // Unchanged bytes use the same validation result, avoiding duplicate CPU work.
  const treatment = normalized ? await baseline.validateCandidateBytes(input.candidate, normalized.bytes) : control;
  const selectedRoles = candidate => ['icon', 'wide'].filter(role => rankCandidates(candidate ? [candidate] : [], { preferences: { logo: { theme: 'light' }, icon: { theme: 'light' } } }).selectedByRole[role]);
  const row = { id: input.id, cohort: input.cohort, path: input.path, sourceUrl: input.candidate.url,
    originalHash: sha256(original), normalizedHash: normalized ? sha256(normalized.bytes) : null,
    normalized: Boolean(normalized), baselineValidated: Boolean(control), treatmentValidated: Boolean(treatment),
    baselineRoles: selectedRoles(control), treatmentRoles: selectedRoles(treatment),
    ...(normalized ? { transformation: normalized.transformation } : {}),
  };
  if (normalized) {
    await writeFile(resolve(output, `${input.id}-${row.normalizedHash.slice(0, 12)}-normalized.svg`), normalized.bytes);
    const originalPixels = await sharp(original).resize(800, 200, { fit: 'contain', background: '#fff' }).flatten({ background: '#fff' }).raw().toBuffer();
    const normalizedPixels = await sharp(normalized.bytes).resize(800, 200, { fit: 'contain', background: '#fff' }).flatten({ background: '#fff' }).raw().toBuffer();
    row.identicalRenderedPixels = originalPixels.equals(normalizedPixels);
    const image = await sharp(normalized.bytes).resize(700, 135, { fit: 'contain', background: '#fff' }).flatten({ background: '#fff' }).png().toBuffer();
    const label = Buffer.from(`<svg width="740" height="40"><text x="15" y="27" font-size="20">${input.id}</text></svg>`);
    panels.push(await sharp({ create: { width: 740, height: 190, channels: 4, background: '#fff' } }).composite([{ input: label, top: 0, left: 0 }, { input: image, top: 45, left: 20 }]).png().toBuffer());
    console.log(JSON.stringify(row));
  }
  rows.push(row);
}
if (panels.length) await sharp({ create: { width: 740, height: panels.length * 190, channels: 4, background: '#fff' } }).composite(panels.map((input, index) => ({ input, top: index * 190, left: 0 }))).png().toFile(resolve(output, 'review.png'));
const summary = {
  generatedAt: new Date().toISOString(), baselineSource: baselinePath,
  baselineExtractorHash: sha256(await readFile(resolve(baselinePath, 'extractor.mjs'))),
  treatmentHelperHash: sha256(await readFile(new URL('../../src/standalone-svg.mjs', import.meta.url))),
  libraryManifestHash: sha256(await readFile(manifestPath)),
  inputs: rows.length, normalized: rows.filter(row => row.normalized).length,
  baselineValidated: rows.filter(row => row.baselineValidated).length,
  treatmentValidated: rows.filter(row => row.treatmentValidated).length,
  lostValidated: rows.filter(row => row.baselineValidated && !row.treatmentValidated).length,
  pixelIdenticalNormalizations: rows.filter(row => row.identicalRenderedPixels).length,
  rows,
};
await writeFile(resolve(output, 'results.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ ...summary, rows: undefined }));
