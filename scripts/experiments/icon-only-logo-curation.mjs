#!/usr/bin/env node
// Task-scoped helper for staging already-captured, visually reviewable logo
// candidates from a brand-library run. It does not discover new URLs.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import sharp from 'sharp';
import { internals as extractor } from '../../src/extractor.mjs';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1];
};
const root = resolve(option('--root') ?? 'brand-library/v2');
const runId = option('--run');
const planPath = option('--plan');
const normalizeOnly = args.includes('--normalize-only');
const decisionsConfigPath = option('--write-decisions');
const restorationsPath = option('--write-restorations');
const syncApproved = args.includes('--sync-approved');
if (!runId || (!planPath && !normalizeOnly && !decisionsConfigPath && !restorationsPath && !syncApproved)) {
  throw new Error('Usage: node scripts/experiments/icon-only-logo-curation.mjs --root ROOT --run RUN_ID (--plan PLAN.json | --normalize-only | --write-decisions CONFIG.json | --write-restorations FILE.json | --sync-approved)');
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const writeJson = async (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const reportPath = resolve(root, 'runs', runId, 'report.json');
const report = await readJson(reportPath);
const plan = planPath ? await readJson(resolve(planPath)) : { records: [] };
const byId = new Map(report.records.map(record => [record.brand.id, record]));

const decodeDataUrl = value => {
  const match = String(value).match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) return null;
  return match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
};

async function download(url) {
  const inline = decodeDataUrl(url);
  if (inline) return { bytes: inline, resolvedUrl: url };
  if (url.startsWith('zip+')) throw new Error('Archive members must be staged by the extractor, not this helper.');
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'LogoYoinkBrandLibrary/1.0 (captured-candidate review)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok || ![429, 503].includes(response.status)) break;
    await response.body?.cancel();
    await new Promise(done => setTimeout(done, 1000 * (attempt + 1)));
  }
  if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 'network'}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 3 * 1024 * 1024) throw new Error('Candidate exceeds 3 MiB.');
  return { bytes, resolvedUrl: response.url };
}

async function visualHash(bytes) {
  const normalized = await sharp(bytes, { density: 192 })
    .resize(256, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha().raw().toBuffer();
  return sha256(normalized);
}

function honestTheme(candidate) {
  if (['light', 'dark'].includes(candidate.evidence?.theme)) return candidate.evidence.theme;
  const contrast = candidate.tinySuitability?.surface_contrast;
  if (!contrast) return 'any';
  if (contrast.light < 0.08 && contrast.dark >= 0.2) return 'dark';
  if (contrast.dark < 0.08 && contrast.light >= 0.2) return 'light';
  return 'any';
}

function representation(candidate, width, height) {
  if (candidate.stacked_logo) return 'stacked_lockup';
  if (width && height && width / height < 2.5) return 'compact_wordmark';
  return 'wordmark_or_lockup';
}

const outcomes = [];
for (const entry of normalizeOnly ? [] : plan.records) {
  const record = byId.get(entry.brandId);
  if (!record) throw new Error(`Unknown run brand: ${entry.brandId}`);
  const evidencePath = resolve(root, 'runs', runId, 'evidence', `${entry.brandId}.json`);
  const evidence = await readJson(evidencePath);
  const matches = (evidence.candidates ?? []).filter(candidate => {
    if (entry.sourceUrl && candidate.url !== entry.sourceUrl) return false;
    if (entry.urlIncludes && !String(candidate.url).includes(entry.urlIncludes)) return false;
    if (entry.source && candidate.source !== entry.source) return false;
    if (entry.width && candidate.width !== entry.width) return false;
    if (entry.height && candidate.height !== entry.height) return false;
    return true;
  });
  if (!matches.length || (matches.length !== 1 && !Number.isInteger(entry.matchIndex))) {
    throw new Error(`${entry.brandId}: expected one candidate, found ${matches.length}`);
  }
  const captured = matches[entry.matchIndex ?? 0];
  try {
    const downloaded = await download(captured.url);
    const validated = await extractor.validateCandidateBytes(captured, downloaded.bytes, {
      resolvedUrl: downloaded.resolvedUrl,
      status: 200,
      contentType: null,
    });
    if (!validated?.dataUrl) throw new Error('Candidate failed validation.');
    const bytes = Buffer.from(validated.dataUrl.split(',')[1], 'base64');
    const metadata = await sharp(bytes, { density: 192 }).metadata();
    const inferredFormat = metadata.format ?? extname(new URL(downloaded.resolvedUrl).pathname).slice(1);
    const format = metadata.format === 'svg' ? 'svg' : inferredFormat || 'bin';
    const hash = sha256(bytes);
    const relativePath = `assets/${entry.brandId}/logo/${hash}.${format}`;
    const absolutePath = resolve(root, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
    const checkedAt = new Date().toISOString();
    const candidate = {
      role: 'logo',
      theme: honestTheme(validated),
      locale: 'global',
      representation: entry.representation ?? representation(validated, metadata.width, metadata.height),
      path: relativePath,
      format,
      width: metadata.width ?? validated.width ?? null,
      height: metadata.height ?? validated.height ?? null,
      bytes: bytes.length,
      contentHash: hash,
      visualHash: await visualHash(bytes),
      sourceUrl: captured.url,
      discoveryPage: captured.source_page ?? record.homepage ?? record.brand.officialHomepage,
      sourceKind: captured.source ?? 'captured-candidate',
      provenanceChain: captured.provenance_chain ?? captured.provenance ?? [],
      transformation: validated.transformation ?? validated.transformations ?? null,
      verificationStatus: 'staged_ai_visual_review_required',
      lastCheckedAt: checkedAt,
      lastConfirmedCurrentAt: null,
    };
    record.roles.logo = { role: 'logo', previous: record.roles.logo?.previous ?? null, candidate, change: 'new_asset', status: 'staged_supplement' };
    record.checkedAt = checkedAt;
    delete record.error;
    outcomes.push({ brandId: entry.brandId, status: 'staged', path: relativePath, sourceUrl: captured.url });
  } catch (error) {
    outcomes.push({ brandId: entry.brandId, status: 'failed', error: error.message, sourceUrl: captured.url });
  }
  await new Promise(done => setTimeout(done, 700));
}

for (const record of report.records) {
  const staged = record.roles.logo?.candidate;
  if (!staged) continue;
  staged.representation ??= representation({}, staged.width, staged.height);
  try {
    const evidence = await readJson(resolve(root, 'runs', runId, 'evidence', `${record.brand.id}.json`));
    const observed = evidence.assets?.logo?.url === staged.sourceUrl
      ? evidence.assets.logo
      : (evidence.candidates ?? []).find(candidate => candidate.url === staged.sourceUrl);
    if (!observed) continue;
    staged.theme = honestTheme(observed);
    if (observed.stacked_logo) staged.representation = 'stacked_lockup';
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

report.supplementedAt = new Date().toISOString();
report.summary.candidateWordmarks = report.records.filter(record => record.roles.logo?.candidate).length;
await writeJson(reportPath, report);
if (!normalizeOnly && planPath) {
  await writeJson(resolve(root, 'runs', runId, 'captured-candidate-staging.json'), {
    runId,
    createdAt: new Date().toISOString(),
    plan: resolve(planPath),
    outcomes,
  });
}
if (decisionsConfigPath) {
  const config = await readJson(resolve(decisionsConfigPath));
  const logoRejects = new Map(config.logoRejects.map(item => [item.brandId, item.reason]));
  const decisions = [];
  for (const record of report.records) {
    if (record.roles.icon?.candidate) decisions.push({
      brandId: record.brand.id,
      role: 'icon',
      action: 'reject',
      reason: config.iconReason,
    });
    if (record.roles.logo?.candidate && logoRejects.has(record.brand.id)) decisions.push({
      brandId: record.brand.id,
      role: 'logo',
      action: 'reject',
      reason: logoRejects.get(record.brand.id),
    });
  }
  const output = resolve(root, config.output);
  await writeJson(output, {
    schemaVersion: 1,
    runId,
    sourceReport: `runs/${runId}/report.json`,
    reviewer: 'Codex practical visual review',
    reviewedAt: new Date().toISOString(),
    decisions,
  });
  console.log(JSON.stringify({ decisionFile: output, iconRejects: decisions.filter(item => item.role === 'icon').length, logoRejects: decisions.filter(item => item.role === 'logo').length }, null, 2));
}
if (restorationsPath) {
  const manifest = await readJson(resolve(root, 'manifest.json'));
  const approved = new Map(manifest.brands.map(brand => [brand.id, brand]));
  const decisions = report.records.flatMap(record => {
    const candidate = record.roles.logo?.candidate;
    const brand = approved.get(record.brand.id);
    if (!candidate || brand?.assets?.logo) return [];
    const withdrawn = [...(brand?.notes ?? [])].reverse().find(note =>
      note.kind === 'approved_asset_withdrawn' && note.role === 'logo' && note.contentHash === candidate.contentHash);
    if (!withdrawn) return [];
    return [{
      brandId: record.brand.id,
      role: 'logo',
      action: 'restore',
      reason: `Corrected transparent light/dark review confirms the company-name artwork is clean and identity-correct; prior bars were review-sheet padding. Relabel as ${candidate.theme} / ${candidate.representation}.`,
    }];
  });
  await writeJson(resolve(root, restorationsPath), {
    reviewer: 'Codex corrected visual review',
    reviewedAt: new Date().toISOString(),
    decisions,
  });
  console.log(JSON.stringify({ restorationFile: resolve(root, restorationsPath), restorations: decisions.length }, null, 2));
}
if (syncApproved) {
  const manifestPath = resolve(root, 'manifest.json');
  const manifest = await readJson(manifestPath);
  const approved = new Map(manifest.brands.map(brand => [brand.id, brand]));
  let synced = 0;
  for (const record of report.records) {
    const candidate = record.roles.logo?.candidate;
    const current = approved.get(record.brand.id)?.assets?.logo;
    if (!candidate || !current || current.contentHash !== candidate.contentHash) continue;
    approved.get(record.brand.id).assets.logo = {
      ...candidate,
      verificationStatus: current.verificationStatus,
      lastConfirmedCurrentAt: current.lastConfirmedCurrentAt,
    };
    synced++;
  }
  manifest.generatedAt = new Date().toISOString();
  await writeJson(manifestPath, manifest);
  console.log(JSON.stringify({ syncedApprovedLogos: synced }, null, 2));
}
console.log(JSON.stringify({ staged: outcomes.filter(row => row.status === 'staged').length, failed: outcomes.filter(row => row.status === 'failed').length }, null, 2));
