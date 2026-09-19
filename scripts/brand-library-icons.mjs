#!/usr/bin/env node
// Bounded icon collection for the baseline logo-only cohort. Collection never approves or
// writes brand-library assets; approve only after inspecting the generated light/dark sheets.
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { yoink } from '../src/index.mjs';
import { mapConcurrent } from '../src/concurrency.mjs';
import { decodeIcoFrame } from '../src/ico.mjs';

const execFile = promisify(execFileCallback);
const args = process.argv.slice(2);
const command = args.shift() ?? 'collect';
const option = name => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const has = name => args.includes(name);
const ROOT = resolve(option('--root') ?? 'brand-library/v2');
const TASK_ROOT = resolve(option('--task-root') ?? 'reports/logo-only-icons-2026-09-19');
const BASELINE_REF = option('--baseline-ref') ?? '9e43e79';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const writeJson = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value, null, 2) + '\n'); };
const exists = async path => access(path).then(() => true, () => false);
const relativeRepoPath = path => relative(process.cwd(), path).split('\\').join('/');
const xml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
const sourceUrlFor = (sourceUrl, discoveryPage, fallback) => {
  const value = sourceUrl == null ? '' : String(sourceUrl);
  return /^data:/i.test(value) || !value ? discoveryPage ?? fallback ?? null : value;
};
const formatFor = asset => {
  const format = String(asset?.format ?? '').toLowerCase();
  return new Set(['svg', 'png', 'webp', 'jpg', 'jpeg', 'gif', 'ico', 'avif']).has(format) ? format : 'bin';
};

function decodeDataUrl(dataUrl) {
  const comma = String(dataUrl ?? '').indexOf(',');
  if (comma < 0) throw new Error('Icon candidate did not contain a data URL payload.');
  const head = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  return /;base64/i.test(head) ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload));
}

async function baselineBrands() {
  const { stdout } = await execFile('git', ['show', `${BASELINE_REF}:brand-library/v2/manifest.json`], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const baseline = JSON.parse(stdout);
  return baseline.brands.filter(brand => brand.assets?.logo && !brand.assets?.icon);
}

async function loadScope() {
  const baseline = await baselineBrands();
  const current = await readJson(resolve(ROOT, 'manifest.json'));
  const currentById = new Map(current.brands.map(brand => [brand.id, brand]));
  for (const brand of baseline) {
    const row = currentById.get(brand.id);
    if (!row) throw new Error(`Baseline icon target is absent from current manifest: ${brand.id}`);
    if (row.assets?.logo?.contentHash !== brand.assets.logo.contentHash) throw new Error(`Wide asset changed outside the icon task: ${brand.id}`);
  }
  return { baseline, current, currentById };
}

function candidateMetadata(brand, attempt, asset, result, file, bytes) {
  const discoveryPage = asset.sourcePage ?? result.homepage ?? brand.officialHomepage;
  return {
    brandId: brand.id, name: brand.name, domain: brand.domain, attempt, checkedAt: new Date().toISOString(),
    role: 'icon', file: relativeRepoPath(file), format: formatFor(asset), width: asset.width ?? null, height: asset.height ?? null,
    bytes: bytes.length, contentHash: sha256(bytes), sourceUrl: sourceUrlFor(asset.resolvedUrl ?? asset.resolved_url ?? asset.url, discoveryPage, brand.officialHomepage),
    discoveryPage, sourceKind: asset.source ?? 'unknown',
    theme: asset.theme ?? asset.variant?.theme ?? 'any', evidence: asset.evidence ?? null,
    provenance: asset.provenance ?? asset.provenanceChain ?? [], scoreReasons: asset.score_reasons ?? asset.scoreReasons ?? [],
    confidenceBand: asset.confidence_band ?? asset.confidenceBand ?? null, diagnostics: result.diagnostics ?? null,
    reviewStatus: 'candidate_visual_review_required',
  };
}

async function collectAttempt(brand, attempt, options) {
  const checkedAt = new Date().toISOString();
  try {
    const result = await yoink(brand.domain, options);
    const asset = result.assets?.icon ?? null;
    if (!asset?.dataUrl) return { brandId: brand.id, name: brand.name, domain: brand.domain, attempt, checkedAt, status: 'no_icon_candidate', diagnostics: result.diagnostics ?? null };
    const bytes = decodeDataUrl(asset.dataUrl);
    const format = formatFor(asset);
    const file = resolve(TASK_ROOT, 'candidates', brand.id, `${attempt}.${format}`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
    return { brandId: brand.id, name: brand.name, domain: brand.domain, attempt, checkedAt, status: 'candidate', candidate: candidateMetadata(brand, attempt, asset, result, file, bytes) };
  } catch (error) {
    return { brandId: brand.id, name: brand.name, domain: brand.domain, attempt, checkedAt, status: /(?:408|425|429|5\d\d|abort|fetch|network|rate.?limit|temporar|tim(?:e|ed)[ -]?out|unavailable|connection)/i.test(error.message) ? 'transient_failure' : 'unresolved_source', error: error.message };
  }
}

async function collect() {
  const { baseline } = await loadScope();
  await mkdir(TASK_ROOT, { recursive: true });
  const checkpointRoot = resolve(TASK_ROOT, 'checkpoints');
  await mkdir(checkpointRoot, { recursive: true });
  const workers = Math.min(4, Math.max(1, Number(option('--workers') ?? 4)));
  const firstOptions = { deep: false, wikimedia: false, sitemap: false, bimi: false, cachedFavicon: true };
  const secondOptions = { deep: true, wikimedia: true, sitemap: false, bimi: false, cachedFavicon: true };
  const checkpointPath = brandId => resolve(checkpointRoot, `${brandId}.json`);
  const checkpoints = new Map();
  for (const brand of baseline) {
    const path = checkpointPath(brand.id);
    if (await exists(path)) {
      const checkpoint = await readJson(path);
      if (checkpoint.brandId === brand.id && Array.isArray(checkpoint.attempts)) checkpoints.set(brand.id, checkpoint);
    }
  }
  const saveAttempt = async (brand, result) => {
    const checkpoint = checkpoints.get(brand.id) ?? { brandId: brand.id, name: brand.name, domain: brand.domain, attempts: [] };
    checkpoint.attempts = [...checkpoint.attempts.filter(attempt => attempt.attempt !== result.attempt), result];
    checkpoint.updatedAt = new Date().toISOString();
    checkpoints.set(brand.id, checkpoint);
    await writeJson(checkpointPath(brand.id), checkpoint);
    return result;
  };
  const missingAttempt = attempt => baseline.filter(brand => !checkpoints.get(brand.id)?.attempts.some(row => row.attempt === attempt));
  await mapConcurrent(missingAttempt('official'), workers, async brand => saveAttempt(brand, await collectAttempt(brand, 'official', firstOptions)));
  const firstById = new Map(baseline.map(brand => [brand.id, checkpoints.get(brand.id)?.attempts.find(attempt => attempt.attempt === 'official')]));
  const retryBrands = baseline.filter(brand => firstById.get(brand.id)?.status !== 'candidate' && !checkpoints.get(brand.id)?.attempts.some(attempt => attempt.attempt === 'deep'));
  await mapConcurrent(retryBrands, workers, async brand => saveAttempt(brand, await collectAttempt(brand, 'deep', secondOptions)));
  const secondById = new Map(baseline.map(brand => [brand.id, checkpoints.get(brand.id)?.attempts.find(attempt => attempt.attempt === 'deep')]));
  const records = baseline.map(brand => {
    const attempts = [firstById.get(brand.id), secondById.get(brand.id)].filter(Boolean);
    const candidates = attempts.filter(row => row.status === 'candidate').map(row => row.candidate);
    return {
      brandId: brand.id, name: brand.name, domain: brand.domain,
      status: candidates.length ? 'candidate_available' : attempts.some(row => row.status === 'transient_failure') ? 'transient_failure' : 'no_candidate_found',
      attempts, candidates,
    };
  });
  const report = {
    schemaVersion: 1, task: 'logo-only-icon-collection', baselineRef: BASELINE_REF, root: relativeRepoPath(ROOT), generatedAt: new Date().toISOString(),
    method: { first: firstOptions, retry: secondOptions, workers },
    scope: { baselineTargets: baseline.length, ids: baseline.map(brand => brand.id) },
    summary: {
      brands: records.length, candidateAvailable: records.filter(row => row.status === 'candidate_available').length,
      noCandidateFound: records.filter(row => row.status === 'no_candidate_found').length,
      transientFailure: records.filter(row => row.status === 'transient_failure').length,
      officialCandidates: records.filter(row => row.attempts.some(attempt => attempt.attempt === 'official' && attempt.status === 'candidate')).length,
      deepRetryCandidates: records.filter(row => row.attempts.some(attempt => attempt.attempt === 'deep' && attempt.status === 'candidate')).length,
    },
    records,
  };
  await writeJson(resolve(TASK_ROOT, 'collection-report.json'), report);
  console.log(JSON.stringify(report.summary, null, 2));
}

async function review() {
  const reportPath = resolve(option('--report') ?? TASK_ROOT, option('--report') ? '' : 'collection-report.json');
  const report = await readJson(reportPath);
  const candidates = report.records.flatMap(record => record.candidates.map(candidate => ({ ...candidate, name: record.name, domain: record.domain })));
  const pageSize = 24;
  const pageCount = Math.max(1, Math.ceil(candidates.length / pageSize));
  for (const surface of ['light', 'dark']) {
    const background = surface === 'light' ? '#ffffff' : '#111318';
    const foreground = surface === 'light' ? '#16181d' : '#f4f4f5';
    for (let page = 0; page < pageCount; page++) {
      const pageCandidates = candidates.slice(page * pageSize, (page + 1) * pageSize);
      const columns = 4, cardWidth = 520, cardHeight = 190;
      const overlays = [];
      for (let index = 0; index < pageCandidates.length; index++) {
        const candidate = pageCandidates[index], x = index % columns * cardWidth, y = Math.floor(index / columns) * cardHeight;
        let preview;
        try {
          const candidatePath = resolve(candidate.file);
          const input = extname(candidatePath).toLowerCase() === '.ico' ? decodeIcoFrame(await readFile(candidatePath)) : candidatePath;
          preview = await sharp(input.input ?? input, input.options ?? {}).resize(240, 102, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        } catch { preview = null; }
        const label = Buffer.from(`<svg width="${cardWidth}" height="${cardHeight}"><style>text{font-family:Arial,sans-serif;fill:${foreground}}</style><rect x="0.5" y="0.5" width="${cardWidth - 1}" height="${cardHeight - 1}" fill="none" stroke="${surface === 'light' ? '#e5e7eb' : '#30343b'}"/><text x="20" y="27" font-size="16" font-weight="700">${index + 1 + page * pageSize}. ${xml(candidate.name)}</text><text x="20" y="49" font-size="11" opacity=".68">${xml(candidate.brandId)} · ${xml(candidate.attempt)} · ${xml(candidate.sourceKind)}</text><text x="20" y="170" font-size="10" opacity=".68">${xml(candidate.sourceUrl ?? 'no source URL')}</text></svg>`);
        overlays.push({ input: label, left: x, top: y });
        if (preview) overlays.push({ input: preview, left: x + 250, top: y + 58 });
      }
      const output = resolve(TASK_ROOT, 'review', `${surface}-${String(page + 1).padStart(2, '0')}.png`);
      await mkdir(dirname(output), { recursive: true });
      await sharp({ create: { width: columns * cardWidth, height: Math.max(1, Math.ceil(pageCandidates.length / columns) * cardHeight), channels: 4, background } }).composite(overlays).png().toFile(output);
      console.log(output);
    }
  }
  await writeJson(resolve(TASK_ROOT, 'review-candidates.json'), { generatedAt: new Date().toISOString(), sourceReport: relativeRepoPath(reportPath), candidates });
}

async function approve() {
  const { baseline, current, currentById } = await loadScope();
  const decisionsPath = resolve(option('--decisions') ?? TASK_ROOT + '/decisions.json');
  const decisions = await readJson(decisionsPath);
  if (!decisions.reviewer || !decisions.reviewedAt || !Array.isArray(decisions.decisions)) throw new Error('Decisions require reviewer, reviewedAt, and decisions[].');
  const report = await readJson(resolve(TASK_ROOT, 'collection-report.json'));
  const byId = new Map(report.records.map(record => [record.brandId, record]));
  const targetIds = new Set(baseline.map(brand => brand.id));
  const seen = new Set();
  for (const decision of decisions.decisions) {
    if (!targetIds.has(decision.brandId) || seen.has(decision.brandId)) throw new Error(`Invalid or duplicate baseline decision: ${decision.brandId}`);
    if (!['approve', 'no_separate_icon', 'transient_failure', 'unresolved_source'].includes(decision.action)) throw new Error(`Unsupported icon decision: ${decision.action}`);
    if (!decision.reason) throw new Error(`Icon decision requires a reason: ${decision.brandId}`);
    seen.add(decision.brandId);
  }
  if (seen.size !== baseline.length) throw new Error(`Expected decisions for all ${baseline.length} baseline targets, got ${seen.size}.`);
  const now = decisions.reviewedAt;
  for (const decision of decisions.decisions) {
    const brand = currentById.get(decision.brandId);
    const record = byId.get(decision.brandId);
    const candidate = decision.candidateFile
      ? record?.candidates.find(item => item.file === decision.candidateFile)
      : record?.candidates.length === 1 ? record.candidates[0] : null;
    brand.notes = (brand.notes ?? []).filter(note => note.source !== 'logo-only-icon-collection' && !(decision.restoresWithdrawn && note.kind === 'approved_asset_restored' && note.contentHash === candidate?.contentHash));
    if (decision.action !== 'approve' && brand.assets?.icon && candidate?.contentHash === brand.assets.icon.contentHash) delete brand.assets.icon;
    if (decision.action === 'approve') {
      if (!candidate) throw new Error(`Candidate file is absent or ambiguous in collection report: ${decision.brandId}`);
      const source = resolve(candidate.file);
      const bytes = await readFile(source);
      if (sha256(bytes) !== candidate.contentHash) throw new Error(`Candidate hash mismatch: ${decision.brandId}`);
      const destination = resolve(ROOT, 'assets', decision.brandId, 'icon', `${candidate.contentHash}.${candidate.format}`);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
      brand.assets = { ...(brand.assets ?? {}), icon: {
        role: 'icon', theme: decision.theme ?? (candidate.theme === 'light' || candidate.theme === 'dark' ? candidate.theme : 'any'), locale: 'global', representation: decision.representation ?? 'compact_brand_mark',
        path: `assets/${decision.brandId}/icon/${candidate.contentHash}.${candidate.format}`, format: candidate.format,
        width: candidate.width, height: candidate.height, bytes: candidate.bytes, contentHash: candidate.contentHash,
        sourceUrl: sourceUrlFor(candidate.sourceUrl, candidate.discoveryPage, brand.officialHomepage), discoveryPage: candidate.discoveryPage, sourceKind: candidate.sourceKind,
        provenanceChain: candidate.provenance ?? [], transformation: null, verificationStatus: 'approved_ai_visual_review',
        lastCheckedAt: candidate.checkedAt ?? now, lastConfirmedCurrentAt: now,
      }};
      if (decision.restoresWithdrawn) {
        brand.notes = [...(brand.notes ?? []), { role: 'icon', kind: 'approved_asset_restored', contentHash: candidate.contentHash, reason: decision.restorationReason ?? 'Restored after current light/dark visual review confirmed the official mark is valid for its declared theme.', reviewer: decisions.reviewer, reviewedAt: now }];
      }
      brand.notes = (brand.notes ?? []).filter(note => !(note.role === 'icon' && note.kind === 'persistent_role_gap'));
    } else if (decision.action === 'no_separate_icon') {
      brand.notes = [...(brand.notes ?? []), { role: 'icon', kind: 'persistent_role_gap', reason: decision.reason, reviewer: decisions.reviewer, reviewedAt: now, source: 'logo-only-icon-collection' }];
    } else {
      brand.notes = [...(brand.notes ?? []), { role: 'icon', kind: decision.action === 'transient_failure' ? 'icon_collection_transient_failure' : 'icon_collection_unresolved_source', reason: decision.reason, reviewer: decisions.reviewer, reviewedAt: now, source: 'logo-only-icon-collection' }];
    }
    brand.lastCheckedAt = now;
    brand.verificationStatus = brand.assets?.icon && brand.assets?.logo ? 'approved_complete' : brand.assets?.icon || brand.assets?.logo ? 'approved_with_role_gap' : 'unresolved';
  }
  const manifestPath = resolve(ROOT, 'manifest.json');
  const updated = { ...current, generatedAt: now, approvedFromRun: `logo-only-icon-collection-${now.replace(/[:.]/g, '-')}` };
  await writeJson(manifestPath, updated);
  await writeJson(resolve(ROOT, 'approval-history', `icon-collection-${now.replace(/[:.]/g, '-')}.json`), { schemaVersion: 1, task: 'logo-only-icon-collection', reviewer: decisions.reviewer, reviewedAt: now, decisions: decisions.decisions });
  await writeOutcomeReport({ baseline, current: updated, decisions, report });
  console.log(JSON.stringify({ approved: decisions.decisions.filter(decision => decision.action === 'approve').length, noSeparateIcon: decisions.decisions.filter(decision => decision.action === 'no_separate_icon').length, transientFailure: decisions.decisions.filter(decision => decision.action === 'transient_failure').length, unresolvedSource: decisions.decisions.filter(decision => decision.action === 'unresolved_source').length }, null, 2));
}

async function writeOutcomeReport({ baseline, current, decisions, report }) {
  const currentById = new Map(current.brands.map(brand => [brand.id, brand]));
  const byId = new Map(report.records.map(record => [record.brandId, record]));
  const groups = Object.fromEntries(['approve', 'no_separate_icon', 'transient_failure', 'unresolved_source'].map(action => [action, decisions.decisions.filter(decision => decision.action === action).map(decision => decision.brandId)]));
  await writeJson(resolve(TASK_ROOT, 'outcome-report.json'), {
    schemaVersion: 1, task: 'logo-only-icon-collection', baselineRef: BASELINE_REF,
    reviewer: decisions.reviewer, reviewedAt: decisions.reviewedAt,
    scope: { baselineTargets: baseline.length, exactLogoOnlyBaseline: true },
    summary: {
      approvedIcons: groups.approve.length, noSeparateIcon: groups.no_separate_icon.length,
      transientFailure: groups.transient_failure.length, unresolvedSource: groups.unresolved_source.length,
      remainingLogoOnly: current.brands.filter(brand => brand.assets?.logo && !brand.assets?.icon).length,
    },
    outcomes: groups,
    approved: groups.approve.map(brandId => {
      const brand = currentById.get(brandId);
      const icon = brand?.assets?.icon;
      return { brandId, name: brand?.name, sourceUrl: icon?.sourceUrl ?? null, discoveryPage: icon?.discoveryPage ?? null, path: icon?.path ?? null, contentHash: icon?.contentHash ?? null };
    }),
    evidence: { collectionReport: relativeRepoPath(resolve(TASK_ROOT, 'collection-report.json')), decisions: relativeRepoPath(resolve(TASK_ROOT, 'decisions.json')), lightSheets: 'review/light-01.png through review/light-05.png', darkSheets: 'review/dark-01.png through review/dark-05.png' },
    acquisitionSummary: report.summary,
    auditedCandidateRecords: byId.size,
  });
}

async function finalize() {
  const { baseline, current } = await loadScope();
  const decisions = await readJson(resolve(option('--decisions') ?? TASK_ROOT + '/decisions.json'));
  const report = await readJson(resolve(TASK_ROOT, 'collection-report.json'));
  const byCandidateHash = new Map(report.records.flatMap(record => record.candidates.map(candidate => [candidate.contentHash, candidate])));
  const decisionsById = new Map(decisions.decisions.map(decision => [decision.brandId, decision]));
  let repaired = 0;
  for (const brand of current.brands) {
    const icon = brand.assets?.icon;
    const decision = decisionsById.get(brand.id);
    if (icon && decision?.action !== 'approve' && byCandidateHash.has(icon.contentHash)) {
      delete brand.assets.icon;
      brand.verificationStatus = brand.assets?.logo ? 'approved_with_role_gap' : 'unresolved';
      repaired++;
      continue;
    }
    if (!icon || !/^data:/i.test(String(icon.sourceUrl ?? ''))) continue;
    const candidate = byCandidateHash.get(icon.contentHash);
    const sourceUrl = sourceUrlFor(icon.sourceUrl, candidate?.discoveryPage ?? icon.discoveryPage, brand.officialHomepage);
    if (sourceUrl !== icon.sourceUrl) { icon.sourceUrl = sourceUrl; repaired++; }
  }
  if (repaired) await writeJson(resolve(ROOT, 'manifest.json'), current);
  await writeOutcomeReport({ baseline, current, decisions, report });
  console.log(JSON.stringify({ repairedSourceUrls: repaired, remainingLogoOnly: current.brands.filter(brand => brand.assets?.logo && !brand.assets?.icon).length }, null, 2));
}

if (command === 'collect') await collect();
else if (command === 'review') await review();
else if (command === 'approve') await approve();
else if (command === 'finalize') await finalize();
else throw new Error('Usage: node scripts/brand-library-icons.mjs collect|review|approve|finalize [options]');
