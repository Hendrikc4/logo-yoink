#!/usr/bin/env node
// Stage manually researched first-party logo candidates without auto-approving them.
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const input = option('--input');
const only = new Set((option('--only') ?? '').split(',').filter(Boolean));
if (!input) throw new Error('Usage: node scripts/brand-library-stage-deep-search.mjs --input candidate-results.json [--root brand-library/v2]');
const root = resolve(option('--root') ?? 'brand-library/v2');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const write = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value, null, 2) + '\n'); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function embeddedPngFromIco(bytes) {
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) return null;
  const count = bytes.readUInt16LE(4);
  if (count < 1 || count > 64 || bytes.length < 6 + count * 16) throw new Error('Invalid ICO directory.');
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const frames = [];
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16;
    const width = bytes[entry] || 256;
    const height = bytes[entry + 1] || 256;
    const size = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    if (!size || offset < 6 + count * 16 || offset + size > bytes.length) continue;
    const frame = bytes.subarray(offset, offset + size);
    if (frame.subarray(0, 8).equals(pngSignature)) frames.push({ frame, area: width * height });
  }
  frames.sort((a, b) => b.area - a.area);
  return frames[0]?.frame ?? null;
}
const source = await read(resolve(root, 'sources.json'));
const manifest = await read(resolve(root, 'manifest.json'));
const results = await read(resolve(input));
const byId = new Map(source.brands.map(brand => [brand.id, brand]));
const approved = new Map(manifest.brands.map(brand => [brand.id, brand]));
const runId = `deep-search-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const checkedAt = new Date().toISOString();
const records = [];
const seen = new Set();

async function download(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname === 'localhost' || parsed.hostname.endsWith('.local')) throw new Error('Direct HTTPS asset URL required.');
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'LogoYoinkBrandLibrary/2.0 (research verification)' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (new URL(response.url).protocol !== 'https:') throw new Error('Redirected away from HTTPS.');
  const limit = 6 * 1024 * 1024;
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('Asset exceeds 6 MiB limit.');
    chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks), resolvedUrl: response.url };
}

for (const entry of results.records ?? results.results ?? []) {
  if (only.size && !only.has(entry.brandId)) continue;
  if (entry.status !== 'candidate' || !(entry.candidates?.length)) continue;
  if (seen.has(entry.brandId)) throw new Error(`Duplicate brand: ${entry.brandId}`);
  seen.add(entry.brandId);
  const brand = byId.get(entry.brandId);
  if (!brand) throw new Error(`Candidate outside selected roster: ${entry.brandId}`);
  const current = approved.get(entry.brandId);
  const roles = Object.fromEntries(['icon','logo'].map(role => [role, {
    role, previous: current?.assets?.[role] ?? null, candidate: null,
    change: current?.assets?.[role] ? 'blocked_or_missing_retained' : 'missing_unapproved', status: 'missing',
  }]));
  const diagnostics = [];
  for (const proposal of entry.candidates) {
    if (!['icon','logo'].includes(proposal.role) || roles[proposal.role].candidate) continue;
    if (!proposal.url || !proposal.discoveryPage || !proposal.sourceKind) { diagnostics.push({ role: proposal.role, error: 'Missing URL, discovery page, or source kind.' }); continue; }
    try {
      let { bytes, resolvedUrl } = await download(proposal.url);
      let transformation = null;
      const icoPng = embeddedPngFromIco(bytes);
      if (icoPng) {
        bytes = Buffer.from(icoPng);
        transformation = { kind: 'container-extraction', from: 'ico', to: 'png', reason: 'Largest embedded PNG frame' };
      }
      let metadata = await sharp(bytes, { density: 192 }).metadata();
      if (metadata.format === 'heif') {
        bytes = await sharp(bytes).png().toBuffer();
        metadata = await sharp(bytes).metadata();
        transformation = { kind: 'raster-format-conversion', from: 'heif', to: 'png', reason: 'Portable review and use' };
      }
      const format = metadata.format === 'jpeg' ? 'jpg' : metadata.format;
      if (!['svg','png','jpg','webp','avif','gif'].includes(format)) throw new Error(`Unsupported image format: ${format}`);
      const contentHash = hash(bytes);
      const relativePath = `assets/${brand.id}/${proposal.role}/${contentHash}.${format}`;
      const assetPath = resolve(root, relativePath);
      if (await access(assetPath).then(() => true, () => false)) {
        if (hash(await readFile(assetPath)) !== contentHash) throw new Error('Existing content-addressed asset hash mismatch.');
      } else {
        await mkdir(dirname(assetPath), { recursive: true });
        await writeFile(assetPath, bytes);
      }
      const candidate = {
        role: proposal.role, theme: proposal.theme ?? 'any', locale: 'global',
        representation: proposal.representation ?? (proposal.role === 'logo' ? 'wordmark_or_lockup' : 'symbol'),
        path: relativePath, format, width: metadata.width ?? null, height: metadata.height ?? null,
        bytes: bytes.length, contentHash, sourceUrl: resolvedUrl, discoveryPage: proposal.discoveryPage,
        sourceKind: proposal.sourceKind, provenanceChain: [{ kind: 'manual-deep-search', url: proposal.discoveryPage }],
        transformation, verificationStatus: 'staged_ai_visual_review_required',
        lastCheckedAt: checkedAt, lastConfirmedCurrentAt: null,
      };
      roles[proposal.role] = { role: proposal.role, previous: current?.assets?.[proposal.role] ?? null, candidate,
        change: current?.assets?.[proposal.role] ? 'possible_rebrand' : 'new_asset', status: 'staged_supplement' };
      process.stdout.write(`${brand.id}/${proposal.role}: staged\n`);
    } catch (error) {
      diagnostics.push({ role: proposal.role, url: proposal.url, error: error.message });
      process.stdout.write(`${brand.id}/${proposal.role}: ${error.message}\n`);
    }
  }
  records.push({ brand, checkedAt, roles, diagnostics, deepSearchReason: entry.reason ?? null });
}

const summary = { brands: records.length, candidateIcons: records.filter(record => record.roles.icon.candidate).length,
  candidateWordmarks: records.filter(record => record.roles.logo.candidate).length,
  failedCandidates: records.reduce((n,record) => n + record.diagnostics.length, 0) };
const report = { schemaVersion: 1, libraryId: source.libraryId, runId, startedAt: checkedAt,
  completedAt: new Date().toISOString(), input: resolve(input), records, summary };
await write(resolve(root, 'runs', runId, 'report.json'), report);
await write(resolve(root, 'latest-run.json'), { runId, report: `runs/${runId}/report.json` });
console.log(JSON.stringify(summary, null, 2));
