#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import sharp from 'sharp';
import { yoink } from '../src/index.mjs';
import { mapConcurrent } from '../src/concurrency.mjs';

const args = process.argv.slice(2);
const command = args.shift() ?? 'verify';
const option = name => {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1];
};
const has = name => args.includes(name);
const ROOT = resolve(option('--root') ?? 'brand-library/v1');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
};
const exists = async path => access(path).then(() => true, () => false);
const expand = ([id, name, domain, aliases, identityType, parentBrandId]) => ({
  id, name, domain, aliases, identityType, parentBrandId,
  officialHomepage: `https://${domain}/`,
});
const sourceRegistry = await readJson(resolve(ROOT, 'sources.json'));
const brands = sourceRegistry.brands.map(item => Array.isArray(item) ? expand(item) : ({
  ...item, aliases: item.aliases ?? [], identityType: item.identityType ?? 'company',
  parentBrandId: item.parentBrandId ?? null, officialHomepage: item.officialHomepage ?? `https://${item.domain}/`,
}));
const expectedCount = sourceRegistry.expectedCount ?? 100;
const runReportPath = async () => resolve(ROOT, 'runs', option('--run') ?? (await readJson(resolve(ROOT, 'latest-run.json'))).runId, 'report.json');
const reviewImage = (path, width, height) => sharp(path, { density: 192 }).resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

async function visualHash(bytes) {
  try {
    const normalized = await sharp(bytes, { density: 192 }).resize(256, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().raw().toBuffer();
    return sha256(normalized);
  } catch {
    return null;
  }
}

function extFor(asset) {
  const allowed = new Set(['svg', 'png', 'webp', 'jpg', 'jpeg', 'gif', 'ico', 'avif']);
  const ext = String(asset?.format ?? '').toLowerCase();
  return allowed.has(ext) ? ext : 'bin';
}

export function classifyChange(previous, candidate, failure = null) {
  if (failure || !candidate) return previous ? 'blocked_or_missing_retained' : 'missing_unapproved';
  if (!previous) return 'new_asset';
  if (previous.contentHash === candidate.contentHash) {
    return previous.sourceUrl !== candidate.sourceUrl ? 'equivalent_artwork_new_url' : 'unchanged';
  }
  if (previous.visualHash && previous.visualHash === candidate.visualHash) {
    const oldArea = (previous.width ?? 0) * (previous.height ?? 0);
    const newArea = (candidate.width ?? 0) * (candidate.height ?? 0);
    return newArea > oldArea ? 'better_quality_same_artwork' : 'equivalent_artwork_new_bytes';
  }
  return 'possible_rebrand';
}

async function refresh() {
  const approvedPath = resolve(ROOT, 'manifest.json');
  const approved = await exists(approvedPath) ? await readJson(approvedPath) : { brands: [] };
  const prior = new Map(approved.brands.flatMap(brand => Object.entries(brand.assets ?? {}).map(([role, asset]) => [`${brand.id}:${role}`, asset])));
  const only = new Set((option('--only') ?? '').split(',').filter(Boolean));
  const limit = Number(option('--limit') ?? brands.length);
  const start = Number(option('--start') ?? 0);
  const selectedBrands = brands.filter(brand => !only.size || only.has(brand.id) || only.has(brand.domain)).slice(start, start + limit);
  const startedAt = new Date().toISOString();
  const runId = option('--resume-run') ?? startedAt.replace(/[:.]/g, '-');
  const runDir = resolve(ROOT, 'runs', runId);
  await mkdir(runDir, { recursive: true });
  const records = await mapConcurrent(selectedBrands, Number(option('--workers') ?? 4), async brand => {
    const checkedAt = new Date().toISOString();
    try {
      const evidencePath = resolve(runDir, 'evidence', `${brand.id}.json`);
      const reusedEvidence = has('--resume-run') && await exists(evidencePath);
      const result = reusedEvidence ? await readJson(evidencePath) : await yoink(brand.domain);
      if (reusedEvidence) {
        for (const role of ['icon','logo']) {
          const asset = result.assets?.[role];
          if (!asset || asset.dataUrl) continue;
          const hash = asset.observed?.byte_hash;
          const format = extFor(asset);
          if (!hash) throw new Error(`Persisted ${brand.id}/${role} evidence has no content hash.`);
          const path = resolve(ROOT, `assets/${brand.id}/${role}/${hash}.${format}`);
          const bytes = await readFile(path);
          if (sha256(bytes) !== hash) throw new Error(`Persisted ${brand.id}/${role} asset hash mismatch.`);
          asset.dataUrl = `data:${asset.mimeType ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`;
        }
      }
      const roleRecords = {};
      for (const role of ['icon', 'logo']) {
        const asset = result.assets?.[role] ?? null;
        if (!asset?.dataUrl) {
          roleRecords[role] = {
            role, candidate: null,
            previous: prior.get(`${brand.id}:${role}`) ?? null,
            change: classifyChange(prior.get(`${brand.id}:${role}`) ?? null, null),
            status: 'missing',
          };
          continue;
        }
        const bytes = Buffer.from(asset.dataUrl.split(',')[1], 'base64');
        const contentHash = sha256(bytes);
        const format = extFor(asset);
        const relativePath = `assets/${brand.id}/${role}/${contentHash}.${format}`;
        const absolutePath = resolve(ROOT, relativePath);
        if (!await exists(absolutePath)) {
          await mkdir(dirname(absolutePath), { recursive: true });
          await writeFile(absolutePath, bytes);
        }
        const candidate = {
          role,
          theme: asset.theme ?? 'any',
          locale: 'global',
          path: relativePath,
          format,
          width: asset.width ?? null,
          height: asset.height ?? null,
          bytes: bytes.length,
          contentHash,
          visualHash: await visualHash(bytes),
          sourceUrl: asset.resolvedUrl?.startsWith('data:') ? brand.officialHomepage : asset.resolvedUrl,
          discoveryPage: asset.sourcePage ?? result.homepage ?? brand.officialHomepage,
          sourceKind: asset.source ?? 'unknown',
          provenanceChain: asset.provenanceChain ?? asset.provenance_chain ?? [],
          transformation: asset.transformation ?? null,
          verificationStatus: 'staged_ai_visual_review_required',
          lastCheckedAt: checkedAt,
          lastConfirmedCurrentAt: null,
        };
        const previous = prior.get(`${brand.id}:${role}`) ?? null;
        roleRecords[role] = { role, previous, candidate, change: classifyChange(previous, candidate), status: 'staged' };
      }
      const compact = structuredClone(result);
      for (const candidate of compact.candidates ?? []) delete candidate.dataUrl;
      if (!reusedEvidence) await writeJson(evidencePath, compact);
      process.stdout.write(`${brand.id}: ${roleRecords.icon.change}, ${roleRecords.logo.change}\n`);
      return { brand, homepage: result.homepage, checkedAt, roles: roleRecords, diagnostics: result.diagnostics };
    } catch (error) {
      process.stdout.write(`${brand.id}: blocked (${error.message})\n`);
      return {
        brand, checkedAt, error: error.message, diagnostics: error.diagnostics ?? null,
        roles: Object.fromEntries(['icon', 'logo'].map(role => {
          const previous = prior.get(`${brand.id}:${role}`) ?? null;
          return [role, { role, previous, candidate: null, change: classifyChange(previous, null, error), status: 'blocked' }];
        })),
      };
    }
  });
  const report = {
    schemaVersion: 1, libraryId: sourceRegistry.libraryId, runId, startedAt,
    completedAt: new Date().toISOString(), records,
    summary: summarize(records),
  };
  await writeJson(resolve(runDir, 'report.json'), report);
  await writeJson(resolve(ROOT, 'latest-run.json'), { runId, report: `runs/${runId}/report.json` });
  console.log(JSON.stringify(report.summary, null, 2));
}

function summarize(records) {
  const changes = {};
  let icons = 0, logos = 0, blockedBrands = 0;
  for (const record of records) {
    if (record.error) blockedBrands++;
    for (const role of ['icon', 'logo']) {
      const value = record.roles[role];
      if (value.candidate && role === 'icon') icons++;
      if (value.candidate && role === 'logo') logos++;
      changes[value.change] = (changes[value.change] ?? 0) + 1;
    }
  }
  return { brands: records.length, candidateIcons: icons, candidateWordmarks: logos, blockedBrands, changes };
}

async function approve() {
  const report = await readJson(await runReportPath());
  if (!report.review?.reviewedAt) throw new Error(`Run ${report.runId} has not been visually reviewed; curate it before approval.`);
  const currentPath = resolve(ROOT, 'manifest.json');
  const current = await exists(currentPath) ? await readJson(currentPath) : { brands: [] };
  const existing = new Map(current.brands.map(brand => [brand.id, brand]));
  const now = new Date().toISOString();
  for (const record of report.records) {
    const old = existing.get(record.brand.id);
    const assets = { ...(old?.assets ?? {}) };
    const notes = [...(old?.notes ?? [])];
    for (const role of ['icon', 'logo']) {
      const staged = record.roles[role];
      if (staged.status === 'rejected_after_visual_review') {
        notes.push({ role, kind: 'persistent_role_gap', reason: staged.reviewReason, reviewedAt: report.review?.reviewedAt ?? now });
        continue;
      }
      if (!staged.candidate) continue;
      if (notes.some(note => note.kind === 'approved_asset_withdrawn' && note.role === role && note.contentHash === staged.candidate.contentHash) &&
          !notes.some(note => note.kind === 'approved_asset_restored' && note.role === role && note.contentHash === staged.candidate.contentHash)) continue;
      assets[role] = {
        ...staged.candidate,
        verificationStatus: 'approved_ai_visual_review',
        lastConfirmedCurrentAt: now,
      };
    }
    existing.set(record.brand.id, {
      ...(old ?? {}),
      ...record.brand,
      assets,
      lastCheckedAt: record.checkedAt,
      verificationStatus: assets.icon && assets.logo ? 'approved_complete' : assets.icon || assets.logo ? 'approved_with_role_gap' : 'unresolved',
      notes,
    });
  }
  const manifest = {
    schemaVersion: 1, libraryId: sourceRegistry.libraryId,
    generatedAt: now, approvedFromRun: report.runId,
    brands: brands.map(brand => existing.get(brand.id) ?? { ...brand, assets: {}, verificationStatus: 'unresolved', notes: [] }),
  };
  await writeJson(currentPath, manifest);
  await writeJson(resolve(ROOT, 'approval-history', `${report.runId}.json`), manifest);
  console.log(`Approved ${report.records.length} reviewed brand records from ${report.runId}.`);
}

async function supplement() {
  const latest = await readJson(resolve(ROOT, 'latest-run.json'));
  const reportPath = resolve(ROOT, latest.report);
  const report = await readJson(reportPath);
  const supplements = await readJson(resolve(ROOT, 'supplements.json'));
  const byId = new Map(report.records.map(record => [record.brand.id, record]));
  for (const supplement of supplements.records) {
    const record = byId.get(supplement.brandId);
    if (!record) throw new Error(`Supplement references absent brand: ${supplement.brandId}`);
    let bytes;
    let sourceUrl = supplement.url;
    if (supplement.localPath) bytes = await readFile(supplement.localPath);
    else {
      let response;
      for (let attempt = 0; attempt < 4; attempt++) {
        response = await fetch(supplement.url, { redirect: 'follow', headers: { 'user-agent': 'LogoYoinkBrandLibrary/1.0 (offline asset verification)' } });
        if (response.ok) break;
        if (![429, 503].includes(response.status)) break;
        await new Promise(resolveDelay => setTimeout(resolveDelay, 500 * (attempt + 1)));
      }
      if (!response?.ok) {
        console.warn(`Supplement unavailable: ${supplement.brandId}/${supplement.role} HTTP ${response?.status ?? 'network'}`);
        continue;
      }
      sourceUrl = response.url;
      bytes = Buffer.from(await response.arrayBuffer());
    }
    let metadata;
    try { metadata = await sharp(bytes, { density: 192 }).metadata(); }
    catch { console.warn(`Supplement is not renderable: ${supplement.brandId}/${supplement.role}`); continue; }
    const format = metadata.format === 'svg' ? 'svg' : metadata.format ?? extname(new URL(sourceUrl ?? supplement.discoveryPage).pathname).slice(1) ?? 'bin';
    const contentHash = sha256(bytes);
    const relativePath = `assets/${supplement.brandId}/${supplement.role}/${contentHash}.${format}`;
    const path = resolve(ROOT, relativePath);
    if (!await exists(path)) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    }
    const candidate = {
      role: supplement.role, theme: supplement.theme, locale: supplement.locale,
      representation: supplement.representation ?? (supplement.role === 'logo' ? 'wordmark_or_lockup' : 'symbol'),
      path: relativePath, format, width: metadata.width ?? null, height: metadata.height ?? null,
      bytes: bytes.length, contentHash, visualHash: await visualHash(bytes),
      sourceUrl: sourceUrl ?? supplement.discoveryPage, discoveryPage: supplement.discoveryPage,
      sourceKind: supplement.sourceKind, provenanceChain: [
        { kind: supplement.localPath ? 'preserved-reviewed-capture' : 'manual-targeted-research', url: supplement.discoveryPage },
        ...(supplement.localPath ? [{ kind: 'prior-evidence-packet', path: supplement.localPath }] : []),
      ],
      transformation: null, verificationStatus: 'staged_ai_visual_review_required',
      lastCheckedAt: new Date().toISOString(), lastConfirmedCurrentAt: null,
    };
    const previous = record.roles[supplement.role]?.previous ?? null;
    record.roles[supplement.role] = {
      role: supplement.role, previous, candidate,
      change: classifyChange(previous, candidate), status: 'staged_supplement',
    };
    record.checkedAt = candidate.lastCheckedAt;
    delete record.error;
    console.log(`Supplemented ${supplement.brandId}/${supplement.role} from ${supplement.sourceKind}.`);
  }
  report.supplementedAt = new Date().toISOString();
  report.summary = summarize(report.records);
  await writeJson(reportPath, report);
  console.log(JSON.stringify(report.summary, null, 2));
}

async function curate() {
  const reportPath = await runReportPath();
  const report = await readJson(reportPath);
  const decisions = await readJson(resolve(ROOT, option('--decisions') ?? 'review-decisions.json'));
  if (decisions.runId && decisions.runId !== report.runId) throw new Error(`Review decisions target ${decisions.runId}, not ${report.runId}.`);
  if (decisions.sourceReport && decisions.sourceReport !== `runs/${report.runId}/report.json`) throw new Error(`Review decisions target ${decisions.sourceReport}, not ${report.runId}.`);
  if (!decisions.reviewer || !decisions.reviewedAt) throw new Error('Review decisions require reviewer and reviewedAt.');
  const byId = new Map(report.records.map(record => [record.brand.id, record]));
  for (const decision of decisions.decisions) {
    const record = byId.get(decision.brandId);
    if (!record) throw new Error(`Review decision references absent brand: ${decision.brandId}`);
    if (decision.action === 'reject') {
      if (!record.roles[decision.role]?.candidate && record.roles[decision.role]?.status !== 'rejected_after_visual_review') throw new Error(`Review decision references no staged ${decision.role}: ${decision.brandId}`);
      record.roles[decision.role] = {
        ...record.roles[decision.role], candidate: null, status: 'rejected_after_visual_review',
        change: record.roles[decision.role]?.previous ? 'blocked_or_missing_retained' : 'missing_unapproved',
        reviewReason: decision.reason,
      };
    } else throw new Error(`Unsupported review action: ${decision.action}`);
  }
  report.curatedAt = new Date().toISOString();
  report.review = { reviewer: decisions.reviewer, reviewedAt: decisions.reviewedAt, decisions: decisions.decisions.length };
  report.summary = summarize(report.records);
  await writeJson(reportPath, report);
  console.log(JSON.stringify(report.summary, null, 2));
}

async function verify() {
  const errors = [];
  if (brands.length !== expectedCount) errors.push(`sources.json has ${brands.length} brands, expected ${expectedCount}`);
  const ids = new Set(), domains = new Set();
  for (const brand of brands) {
    if (ids.has(brand.id)) errors.push(`duplicate id: ${brand.id}`);
    if (domains.has(brand.domain)) errors.push(`duplicate domain: ${brand.domain}`);
    ids.add(brand.id); domains.add(brand.domain);
  }
  if (sourceRegistry.schemaVersion >= 2) for (const brand of brands) {
    if (brand.parentBrandId && !ids.has(brand.parentBrandId)) errors.push(`missing parent: ${brand.id} -> ${brand.parentBrandId}`);
  }
  const manifestPath = resolve(ROOT, 'manifest.json');
  const manifest = await exists(manifestPath) ? await readJson(manifestPath) : null;
  if (!manifest) errors.push('manifest.json does not exist');
  else {
    if (manifest.brands.length !== expectedCount) errors.push(`manifest has ${manifest.brands.length} brands, expected ${expectedCount}`);
    const manifestIds = new Set(manifest.brands.map(brand => brand.id));
    for (const brand of brands) if (!manifestIds.has(brand.id)) errors.push(`manifest missing identity: ${brand.id}`);
    for (const brand of manifest.brands) if (!ids.has(brand.id)) errors.push(`manifest has out-of-scope identity: ${brand.id}`);
    for (const brand of manifest.brands) {
      const selected = Object.entries(brand.assets ?? {});
      const variants = Object.entries(brand.variants ?? {}).flatMap(([role, values]) => values.map(asset => [role, asset]));
      for (const [role, asset] of [...selected, ...variants]) {
        if (brand.notes?.some(note => note.kind === 'approved_asset_withdrawn' && note.role === role && note.contentHash === asset.contentHash) &&
            !brand.notes?.some(note => note.kind === 'approved_asset_restored' && note.role === role && note.contentHash === asset.contentHash)) errors.push(`withdrawn asset still approved: ${brand.id}/${role}`);
        const path = resolve(ROOT, asset.path);
        if (!await exists(path)) { errors.push(`missing file: ${brand.id}/${role}`); continue; }
        const bytes = await readFile(path);
        if (sha256(bytes) !== asset.contentHash) errors.push(`hash mismatch: ${brand.id}/${role}`);
        if (!asset.sourceUrl || !asset.discoveryPage || !asset.lastCheckedAt || !asset.lastConfirmedCurrentAt) errors.push(`incomplete provenance: ${brand.id}/${role}`);
      }
    }
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    const approvedAssets = manifest.brands.reduce((count, brand) =>
      count + Object.keys(brand.assets ?? {}).length + Object.values(brand.variants ?? {}).flat().length, 0);
    console.log(`Verified exactly ${expectedCount} distinct brands and ${approvedAssets} approved immutable assets.`);
  }
}

async function coverage() {
  const runRoot = resolve(ROOT, 'runs');
  const manifest = await readJson(resolve(ROOT, 'manifest.json'));
  const manifestById = new Map(manifest.brands.map(brand => [brand.id, brand]));
  const researchById = new Map();
  const researchFiles = [];
  const deepSearchRoot = resolve(ROOT, 'deep-search');
  if (await exists(deepSearchRoot)) {
    for (const file of (await readdir(deepSearchRoot)).filter(name => name.endsWith('.json')).sort()) {
      const relativePath = `deep-search/${file}`;
      const research = await readJson(resolve(deepSearchRoot, file));
      researchFiles.push(relativePath);
      const add = (brandId, evidence) => {
        if (!brandId) return;
        const values = researchById.get(brandId) ?? [];
        values.push({ sourceFile: relativePath, ...evidence });
        researchById.set(brandId, values);
      };
      for (const tested of research.tested ?? []) {
        add(tested.brandId, {
          rawStatus: tested.outcome ?? 'unknown',
          status: tested.outcome === 'no-approved-candidate' ? 'no-art-found' : tested.outcome ?? 'unknown',
          candidates: [], reason: tested.reason ?? null,
        });
      }
      for (const result of research.results ?? []) {
        add(result.brandId, {
          rawStatus: result.status ?? 'unknown',
          status: result.status === 'not-found' ? 'no-art-found' : result.status ?? 'unknown',
          candidates: result.candidates ?? [], reason: result.reason ?? null,
        });
      }
    }
  }

  const rejectedCandidates = new Map();
  const decisionFiles = [];
  for (const file of (await readdir(ROOT)).filter(name => name.startsWith('review-') && name.endsWith('.json')).sort()) {
    const decisions = await readJson(resolve(ROOT, file));
    decisionFiles.push(file);
    for (const decision of decisions.decisions ?? []) {
      if (decision.action !== 'reject' || !decision.brandId || !decision.role) continue;
      const key = `${decision.brandId}:${decision.role}`;
      const values = rejectedCandidates.get(key) ?? [];
      values.push({ sourceFile: file, reason: decision.reason ?? null, reviewedAt: decision.reviewedAt ?? decisions.reviewedAt ?? null });
      rejectedCandidates.set(key, values);
    }
  }

  const rightsPath = resolve(ROOT, 'rights-notes.json');
  const rightsById = new Map();
  if (await exists(rightsPath)) {
    for (const record of (await readJson(rightsPath)).records ?? []) {
      const values = rightsById.get(record.brandId) ?? [];
      values.push({ ...record, sourceFile: 'rights-notes.json' });
      rightsById.set(record.brandId, values);
    }
  }

  const recoveryRoot = resolve('reports/missing-logo-program-2026-09-19');
  const gapAnalysisPath = resolve(recoveryRoot, 'gap-analysis.json');
  const comparisonPath = resolve(recoveryRoot, 'comparison.json');
  const reviewedCandidatesPath = resolve(recoveryRoot, 'reviewed-candidates/manifest.json');
  const recoveryById = new Map();
  const reviewedCandidatesById = new Map();
  let gapAnalysis = null;
  let comparison = null;
  let reviewedCandidatesManifest = null;
  if (await exists(gapAnalysisPath)) {
    gapAnalysis = await readJson(gapAnalysisPath);
    for (const row of gapAnalysis.rows ?? []) {
      const current = manifestById.get(row.id) ?? {};
      const currentMissingRoles = [
        row.missingIcon && !current.assets?.icon ? 'icon' : null,
        row.missingWide && !current.assets?.logo ? 'logo' : null,
      ].filter(Boolean);
      recoveryById.set(row.id, {
        sourceFile: 'reports/missing-logo-program-2026-09-19/gap-analysis.json',
        split: row.split ?? null, previouslyExposed: row.previouslyExposed ?? null,
        currentExperiment: row.currentExperiment ?? null, currentMissingRoles,
        missingIcon: Boolean(row.missingIcon), missingWide: Boolean(row.missingWide),
      });
    }
  }
  if (await exists(comparisonPath)) comparison = await readJson(comparisonPath);
  if (await exists(reviewedCandidatesPath)) {
    reviewedCandidatesManifest = await readJson(reviewedCandidatesPath);
    for (const row of reviewedCandidatesManifest.rows ?? []) {
      const { validatedFile, ...metadata } = row;
      reviewedCandidatesById.set(row.id, { ...metadata, sourceFile: 'reports/missing-logo-program-2026-09-19/reviewed-candidates/manifest.json' });
    }
  }

  const runEvidenceById = new Map();
  const runReports = [];
  const isTransientFailure = message => /(?:408|425|429|5\d\d|abort|fetch|network|rate.?limit|temporar|tim(?:e|ed)[ -]?out|unavailable|connection)/i.test(String(message ?? ''));
  const addRunEvidence = (brandId, evidence) => {
    if (!brandId) return;
    const values = runEvidenceById.get(brandId) ?? [];
    values.push(evidence);
    runEvidenceById.set(brandId, values);
  };
  if (await exists(runRoot)) {
    for (const runId of (await readdir(runRoot)).sort()) {
      const reportPath = resolve(runRoot, runId, 'report.json');
      if (!await exists(reportPath)) continue;
      const report = await readJson(reportPath);
      runReports.push(`runs/${runId}/report.json`);
      for (const record of report.records ?? []) {
        const brandId = record.brand?.id;
        if (record.error && isTransientFailure(record.error)) addRunEvidence(brandId, { runId, role: null, error: record.error, sourceFile: `runs/${runId}/report.json` });
        for (const role of ['icon', 'logo']) {
          const value = record.roles?.[role];
          if (value?.status === 'blocked' && isTransientFailure(record.error ?? value.error)) {
            addRunEvidence(brandId, { runId, role, error: record.error ?? value.error ?? 'blocked', sourceFile: `runs/${runId}/report.json` });
          }
        }
        for (const diagnostic of record.diagnostics ?? []) {
          if (isTransientFailure(diagnostic.error)) addRunEvidence(brandId, { runId, role: diagnostic.role ?? null, error: diagnostic.error, sourceFile: `runs/${runId}/report.json` });
        }
      }
    }
  }

  const layoutFor = (asset, role) => {
    const representation = String(asset?.representation ?? '').toLowerCase();
    if (/(?:icon|symbol|square|compact|app[- ]icon|brand[- ]mark)/.test(representation)) return 'compact';
    if (/(?:wordmark|lockup)/.test(representation)) return 'horizontal';
    const width = Number(asset?.width), height = Number(asset?.height);
    if (width > 0 && height > 0 && width / height >= 2) return 'horizontal';
    if (role === 'icon' && width > 0 && height > 0 && width / height <= 1.5) return 'compact';
    return 'unknown';
  };
  const candidateSource = (candidate, reason) => ({
    role: candidate.role ?? null, sourceUrl: candidate.url ?? null, discoveryPage: candidate.discoveryPage ?? null,
    sourceKind: candidate.sourceKind ?? null, theme: candidate.theme ?? null,
    representation: candidate.representation ?? null, layout: layoutFor(candidate, candidate.role), rightsNote: candidate.rightsNote ?? null,
    identityCheck: reason ?? null,
  });
  const approvedSource = (asset, role) => ({
    role, sourceUrl: asset.sourceUrl ?? null, discoveryPage: asset.discoveryPage ?? null,
    sourceKind: asset.sourceKind ?? null, representation: asset.representation ?? null, layout: layoutFor(asset, role),
  });

  const queueRows = brands.map(brand => {
    const current = manifestById.get(brand.id) ?? {};
    const assets = current.assets ?? {};
    const variants = Object.values(current.variants ?? {}).flat();
    const approvedAny = Boolean(Object.keys(assets).length || variants.length);
    const research = researchById.get(brand.id) ?? [];
    const candidates = research.flatMap(evidence => (evidence.candidates ?? []).map(candidate => ({ ...candidate, sourceFile: evidence.sourceFile, researchReason: evidence.reason })));
    const reviewedCandidate = reviewedCandidatesById.get(brand.id) ?? null;
    const recoveryEvidence = recoveryById.get(brand.id) ?? null;
    const reviewedRole = reviewedCandidate?.decision === 'pass' ? (reviewedCandidate.role === 'wide' ? 'logo' : reviewedCandidate.role) : null;
    const pendingCandidateReview = candidates.filter(candidate => {
      const role = candidate.role;
      return ['icon', 'logo'].includes(role) && !assets[role] && !(rejectedCandidates.get(`${brand.id}:${role}`)?.length);
    });
    if (recoveryEvidence?.currentExperiment?.stage === 'eligible_pending_visual_review') {
      for (const role of recoveryEvidence.currentMissingRoles) {
        if (role === reviewedRole) continue;
        pendingCandidateReview.push({
          role, sourceFile: recoveryEvidence.sourceFile, sourceKind: 'missing-logo-program',
          representation: role === 'logo' ? 'wordmark_or_lockup' : 'symbol',
          recoveryStage: recoveryEvidence.currentExperiment.stage,
          recoverySplit: recoveryEvidence.split,
        });
      }
    }
    const restrictions = [
      ...(rightsById.get(brand.id) ?? []).map(record => ({ kind: 'rights-note', ...record })),
      ...research.filter(evidence => evidence.rawStatus === 'permission-gated').map(evidence => ({
        kind: 'research-permission-gated', sourceFile: evidence.sourceFile, reason: evidence.reason,
      })),
    ];
    const transientAcquisitionFailures = [
      ...(runEvidenceById.get(brand.id) ?? []),
      ...research.filter(evidence => /(?:rate.?limited|temporar|timeout|unavailable)/i.test(evidence.rawStatus)).map(evidence => ({
        sourceFile: evidence.sourceFile, error: evidence.reason ?? evidence.rawStatus,
      })),
    ];
    const noArtEvidence = research.filter(evidence => evidence.status === 'no-art-found');
    const hasResearchCandidate = candidates.length > 0;
    const genuinelyNoArt = !approvedAny && !hasResearchCandidate && !restrictions.length && !transientAcquisitionFailures.length && noArtEvidence.length > 0;
    const runEvidence = runEvidenceById.get(brand.id) ?? [];
    const attemptEvidence = [
      ...(runEvidence.length ? ['run-report'] : []),
      ...(research.length ? ['committed-research'] : []),
      ...(current.lastCheckedAt ? ['manifest-lastCheckedAt'] : []),
    ];
    const explicitNeverAttempted = current.attempted === false || current.attemptHistory === 'never_attempted' || brand.attempted === false || brand.attemptHistory === 'never_attempted';
    const unknownAttemptHistory = !attemptEvidence.length && !explicitNeverAttempted;
    return {
      id: brand.id, name: brand.name, domain: brand.domain, officialHomepage: current.officialHomepage ?? brand.officialHomepage,
      identityType: current.identityType ?? brand.identityType, parentBrandId: current.parentBrandId ?? brand.parentBrandId ?? null,
      approved_any: approvedAny, icon_present: Boolean(assets.icon), company_name_logo_present: Boolean(assets.logo),
      approved: Object.fromEntries(['icon', 'logo'].filter(role => assets[role]).map(role => [role, approvedSource(assets[role], role)])),
      approved_variant_count: variants.length,
      research: research.map(evidence => ({
        sourceFile: evidence.sourceFile, status: evidence.status, rawStatus: evidence.rawStatus,
        reason: evidence.reason, candidates: evidence.candidates.map(candidate => candidateSource(candidate, evidence.reason)),
      })),
      recovery: recoveryEvidence ? {
        sourceFile: recoveryEvidence.sourceFile, split: recoveryEvidence.split, previouslyExposed: recoveryEvidence.previouslyExposed,
        currentExperiment: recoveryEvidence.currentExperiment, current_missing_roles: recoveryEvidence.currentMissingRoles,
      } : null,
      reviewed_candidate: reviewedCandidate,
      queue: {
        pending_candidate_review: pendingCandidateReview.map(candidate => ({ ...candidateSource(candidate, candidate.researchReason), sourceFile: candidate.sourceFile, recoveryStage: candidate.recoveryStage ?? null, recoverySplit: candidate.recoverySplit ?? null })),
        reviewed_candidate_pass: reviewedCandidate ? [reviewedCandidate] : [],
        recovery_role_theme_ineligible: recoveryEvidence?.currentExperiment?.stage === 'role_or_theme_ineligible',
        genuinely_no_art: genuinelyNoArt,
        transient_acquisition_failure: transientAcquisitionFailures,
        unresolved_identity_or_source: current.verificationStatus === 'unresolved',
        recorded_restriction: restrictions,
        unknown_attempt_history: unknownAttemptHistory,
        never_attempted: explicitNeverAttempted,
      },
      attempt_history: { state: explicitNeverAttempted ? 'never_attempted' : unknownAttemptHistory ? 'unknown' : 'attempted', evidence: attemptEvidence },
      restrictions,
      notes: current.notes ?? [],
      approved_source_urls: Object.entries(assets).map(([role, asset]) => ({ role, ...approvedSource(asset, role) })),
    };
  });

  const count = predicate => queueRows.filter(predicate).length;
  const recoveryRows = queueRows.filter(row => row.recovery);
  const recoveryStageCount = stage => recoveryRows.filter(row => row.recovery.currentExperiment?.stage === stage).length;
  const recoveryStageRoleCount = stage => recoveryRows.reduce((total, row) => total + (row.recovery.currentExperiment?.stage === stage ? row.recovery.current_missing_roles.length : 0), 0);
  const summary = {
    identities: queueRows.length,
    approved_any: count(row => row.approved_any), icon_present: count(row => row.icon_present), company_name_logo_present: count(row => row.company_name_logo_present),
    both: count(row => row.icon_present && row.company_name_logo_present), icon_only: count(row => row.icon_present && !row.company_name_logo_present), logo_only: count(row => row.company_name_logo_present && !row.icon_present), empty: count(row => !row.approved_any),
    approved_assets: queueRows.reduce((total, row) => total + Object.keys(row.approved).length + row.approved_variant_count, 0),
    approved_layout: ['horizontal', 'compact', 'unknown'].reduce((result, layout) => {
      result[layout] = queueRows.reduce((total, row) => total + Object.values(row.approved).filter(asset => asset.layout === layout).length, 0);
      return result;
    }, {}),
    recovery: {
      eligible_pending_visual_review: recoveryStageCount('eligible_pending_visual_review'),
      eligible_pending_visual_review_roles: recoveryStageRoleCount('eligible_pending_visual_review'),
      role_or_theme_ineligible: recoveryStageCount('role_or_theme_ineligible'),
      role_or_theme_ineligible_roles: recoveryStageRoleCount('role_or_theme_ineligible'),
      reviewed_candidate_passes: queueRows.reduce((total, row) => total + row.queue.reviewed_candidate_pass.length, 0),
      sourceComparison: comparison?.summaries?.all?.stages ?? null,
    },
    queue: {
      pending_candidate_review: count(row => row.queue.pending_candidate_review.length > 0), genuinely_no_art: count(row => row.queue.genuinely_no_art), transient_acquisition_failure: count(row => row.queue.transient_acquisition_failure.length > 0),
      unresolved_identity_or_source: count(row => row.queue.unresolved_identity_or_source), recorded_restriction: count(row => row.queue.recorded_restriction.length > 0), recovery_role_theme_ineligible: count(row => row.queue.recovery_role_theme_ineligible),
      unknown_attempt_history: count(row => row.queue.unknown_attempt_history), never_attempted: count(row => row.queue.never_attempted),
    },
    attempt_history: { attempted: count(row => row.attempt_history.state === 'attempted'), unknown: count(row => row.attempt_history.state === 'unknown'), never_attempted: count(row => row.attempt_history.state === 'never_attempted') },
  };
  const report = {
    schemaVersion: 1, libraryId: sourceRegistry.libraryId, generatedAt: new Date().toISOString(),
    inputs: { sources: 'sources.json', manifest: 'manifest.json', rights: await exists(rightsPath) ? 'rights-notes.json' : null, research: researchFiles, reviewDecisions: decisionFiles, localRunReports: runReports, recovery: {
      gapAnalysis: await exists(gapAnalysisPath) ? 'reports/missing-logo-program-2026-09-19/gap-analysis.json' : null,
      comparison: await exists(comparisonPath) ? 'reports/missing-logo-program-2026-09-19/comparison.json' : null,
      reviewedCandidates: await exists(reviewedCandidatesPath) ? 'reports/missing-logo-program-2026-09-19/reviewed-candidates/manifest.json' : null,
    } },
    summary, brands: queueRows,
  };
  const output = option('--output');
  if (output) {
    await writeJson(resolve(output), report);
    console.log(JSON.stringify({ ...summary, output: resolve(output) }, null, 2));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

async function withdraw() {
  const decisions = await readJson(resolve(ROOT, option('--decisions') ?? 'review-withdrawals.json'));
  if (!decisions.reviewer || !decisions.reviewedAt) throw new Error('Withdrawal decisions require reviewer and reviewedAt.');
  const manifestPath = resolve(ROOT, 'manifest.json');
  const manifest = await readJson(manifestPath);
  const byId = new Map(manifest.brands.map(brand => [brand.id, brand]));
  const seen = new Set();
  for (const decision of decisions.decisions) {
    if (decision.action !== 'withdraw' || !['icon','logo'].includes(decision.role) || !decision.reason) throw new Error(`Invalid withdrawal: ${JSON.stringify(decision)}`);
    const key = `${decision.brandId}:${decision.role}`;
    if (seen.has(key)) throw new Error(`Duplicate withdrawal: ${key}`);
    seen.add(key);
    const brand = byId.get(decision.brandId);
    if (!brand?.assets?.[decision.role]) throw new Error(`No approved asset to withdraw: ${key}`);
    if (decision.contentHash && decision.contentHash !== brand.assets[decision.role].contentHash) throw new Error(`Withdrawal hash mismatch: ${key}`);
  }
  for (const decision of decisions.decisions) {
    const brand = byId.get(decision.brandId);
    const asset = brand.assets[decision.role];
    delete brand.assets[decision.role];
    brand.notes = [...(brand.notes ?? []), { role: decision.role, kind: 'approved_asset_withdrawn', contentHash: asset.contentHash, reason: decision.reason, reviewer: decisions.reviewer, reviewedAt: decisions.reviewedAt }];
    brand.verificationStatus = brand.assets.icon && brand.assets.logo ? 'approved_complete' : brand.assets.icon || brand.assets.logo ? 'approved_with_role_gap' : 'unresolved';
  }
  manifest.generatedAt = new Date().toISOString();
  await writeJson(manifestPath, manifest);
  await writeJson(resolve(ROOT, 'approval-history', `withdraw-${manifest.generatedAt.replace(/[:.]/g, '-')}.json`), { reviewer: decisions.reviewer, reviewedAt: decisions.reviewedAt, decisions: decisions.decisions });
  console.log(`Withdrew ${decisions.decisions.length} approved assets after secondary visual review.`);
}

async function restore() {
  const decisions = await readJson(resolve(ROOT, option('--decisions') ?? 'review-restorations.json'));
  if (!decisions.reviewer || !decisions.reviewedAt) throw new Error('Restoration decisions require reviewer and reviewedAt.');
  const manifestPath = resolve(ROOT, 'manifest.json');
  const manifest = await readJson(manifestPath);
  const byId = new Map(manifest.brands.map(brand => [brand.id, brand]));
  const historyDir = resolve(ROOT, 'approval-history');
  const historicalAssets = new Map();
  for (const file of await readdir(historyDir)) {
    if (!file.endsWith('.json')) continue;
    const snapshot = await readJson(resolve(historyDir, file));
    for (const brand of snapshot.brands ?? []) for (const [role, asset] of Object.entries(brand.assets ?? {})) {
      historicalAssets.set(`${brand.id}:${role}:${asset.contentHash}`, asset);
    }
  }
  const prepared = [], seen = new Set();
  for (const decision of decisions.decisions) {
    if (decision.action !== 'restore' || !['icon','logo'].includes(decision.role) || !decision.reason) throw new Error(`Invalid restoration: ${JSON.stringify(decision)}`);
    const key = `${decision.brandId}:${decision.role}`;
    if (seen.has(key)) throw new Error(`Duplicate restoration: ${key}`);
    seen.add(key);
    const brand = byId.get(decision.brandId);
    if (!brand || brand.assets?.[decision.role]) throw new Error(`Restoration role is absent or already approved: ${key}`);
    const withdrawn = [...(brand.notes ?? [])].reverse().find(note => note.kind === 'approved_asset_withdrawn' && note.role === decision.role);
    if (!withdrawn) throw new Error(`No withdrawal to restore: ${key}`);
    const asset = historicalAssets.get(`${key}:${withdrawn.contentHash}`);
    if (!asset || !await exists(resolve(ROOT, asset.path))) throw new Error(`Original approved asset unavailable: ${key}`);
    prepared.push({ brand, decision, asset });
  }
  for (const {brand,decision,asset} of prepared) {
    brand.assets[decision.role] = { ...asset, verificationStatus: 'approved_ai_visual_review_restored' };
    brand.notes.push({ role: decision.role, kind: 'approved_asset_restored', contentHash: asset.contentHash, reason: decision.reason, reviewer: decisions.reviewer, reviewedAt: decisions.reviewedAt });
    brand.verificationStatus = brand.assets.icon && brand.assets.logo ? 'approved_complete' : 'approved_with_role_gap';
  }
  manifest.generatedAt = new Date().toISOString();
  await writeJson(manifestPath, manifest);
  await writeJson(resolve(historyDir, `restore-${manifest.generatedAt.replace(/[:.]/g, '-')}.json`), { reviewer: decisions.reviewer, reviewedAt: decisions.reviewedAt, decisions: decisions.decisions });
  console.log(`Restored ${prepared.length} assets after corrected visual review.`);
}

async function review() {
  const manifest = await readJson(resolve(ROOT, 'manifest.json'));
  const staged = has('--latest') || option('--run') ? await readJson(await runReportPath()) : null;
  if (has('--withdrawn')) {
    for (const brand of manifest.brands) {
      const withdrawn = (brand.notes ?? []).filter(note => note.kind === 'approved_asset_withdrawn');
      for (const note of withdrawn) {
        const dir = resolve(ROOT, 'assets', brand.id, note.role);
        if (!await exists(dir)) continue;
        const file = (await readdir(dir)).find(name => name.startsWith(`${note.contentHash}.`));
        if (file) brand.assets[note.role] = { path: `assets/${brand.id}/${note.role}/${file}` };
      }
    }
  }
  let displayBrands = manifest.brands;
  if (staged) {
    const byId = new Map(manifest.brands.map(brand => [brand.id, brand]));
    for (const record of staged.records) {
      const old = byId.get(record.brand.id) ?? record.brand;
      byId.set(record.brand.id, {
        ...old,
        assets: Object.fromEntries(['icon','logo'].flatMap(role => {
          const candidate = record.roles[role]?.candidate ?? old.assets?.[role];
          return candidate ? [[role,candidate]] : [];
        })),
      });
    }
    displayBrands = has('--compact') ? staged.records.map(record => byId.get(record.brand.id) ?? record.brand) : brands.map(brand => byId.get(brand.id) ?? brand);
  }
  const outputDir = resolve(ROOT, staged ? `review/staged/${staged.runId}` : has('--withdrawn') ? 'review/withdrawn' : 'review');
  await mkdir(outputDir, { recursive: true });
  const pageSize = Math.min(100, Math.max(1, Number(option('--page-size') ?? 100)));
  const pageCount = Math.ceil(displayBrands.length / pageSize);
  for (const surface of ['light', 'dark']) {
    const bg = surface === 'light' ? '#ffffff' : '#111318';
    const fg = surface === 'light' ? '#16181d' : '#f4f4f5';
    for (let page = 0; page < pageCount; page++) {
    const pageBrands = displayBrands.slice(page * pageSize, (page + 1) * pageSize);
    const columns = 4, cardW = 440, cardH = 180, width = columns * cardW, rows = Math.ceil(pageBrands.length / columns);
    const overlays = [];
    for (let index = 0; index < pageBrands.length; index++) {
      const brand = pageBrands[index], x = index % columns * cardW, y = Math.floor(index / columns) * cardH;
      const icon = brand.variants?.icon?.find(asset => asset.theme === surface) ?? brand.assets?.icon;
      const logo = brand.variants?.logo?.find(asset => asset.theme === surface) ?? brand.assets?.logo;
      const pieces = [];
      if (icon) {
        try { pieces.push({ input: await reviewImage(resolve(ROOT, icon.path), 72, 72), left: x + 20, top: y + 56 }); } catch {}
      }
      if (logo) {
        try { pieces.push({ input: await reviewImage(resolve(ROOT, logo.path), 280, 82), left: x + 132, top: y + 51 }); } catch {}
      }
      const safeName = brand.name.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
      const label = Buffer.from(`<svg width="${cardW}" height="${cardH}"><style>text{font-family:Arial,sans-serif;fill:${fg}}</style><rect x="0.5" y="0.5" width="${cardW-1}" height="${cardH-1}" fill="none" stroke="${surface === 'light' ? '#e5e7eb' : '#30343b'}"/><text x="20" y="27" font-size="16" font-weight="700">${page * pageSize + index+1}. ${safeName}</text><text x="20" y="49" font-size="11" opacity=".68">${brand.id} · ${icon ? 'icon' : 'NO ICON'} · ${logo ? 'wordmark' : 'NO WORDMARK'}</text></svg>`);
      overlays.push({ input: label, left: x, top: y }, ...pieces);
    }
    const path = resolve(outputDir, pageCount === 1 ? `${surface}.png` : `${surface}-${String(page + 1).padStart(2, '0')}.png`);
    await sharp({ create: { width, height: rows * cardH, channels: 4, background: bg } }).composite(overlays).png().toFile(path);
    console.log(path);
    }
  }
}

async function selfTest() {
  const base = { contentHash: 'a', visualHash: 'v', sourceUrl: 'one', width: 10, height: 10 };
  const cases = [
    ['unchanged', base, { ...base }],
    ['equivalent_artwork_new_url', base, { ...base, sourceUrl: 'two' }],
    ['better_quality_same_artwork', base, { ...base, contentHash: 'b', width: 20, height: 20 }],
    ['possible_rebrand', base, { ...base, contentHash: 'b', visualHash: 'z' }],
    ['blocked_or_missing_retained', base, null, new Error('blocked')],
    ['missing_unapproved', null, null, new Error('blocked')],
  ];
  for (const [expected, previous, candidate, failure] of cases) {
    const actual = classifyChange(previous, candidate, failure);
    if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
  }
  const tiny = await sharp({ create: { width: 2, height: 1, channels: 4, background: '#ff0000' } }).png().toBuffer();
  const padded = await reviewImage(tiny, 4, 4);
  const pixel = await sharp(padded).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (pixel.data[3] !== 0) throw new Error('Review padding must be transparent.');
  console.log('Controlled update-classification and transparent-review cases passed.');
}

async function bootstrap() {
  const manifestPath = resolve(ROOT, 'manifest.json');
  const current = await exists(manifestPath) ? await readJson(manifestPath) : { brands: [] };
  const existing = new Map(current.brands.map(brand => [brand.id, brand]));
  const legacy = await readJson(resolve('brand-library/v1/manifest.json'));
  const legacyMap = new Map(legacy.brands.map(brand => [brand.id, brand]));
  const rewrite = asset => asset ? { ...asset, path: `../v1/${asset.path}` } : asset;
  const all = brands.map(brand => {
    const currentBrand = existing.get(brand.id);
    if (currentBrand) return { ...currentBrand, ...brand, assets: currentBrand.assets ?? {}, variants: currentBrand.variants ?? {}, notes: currentBrand.notes ?? [] };
    const previous = legacyMap.get(brand.id);
    if (!previous) return { ...brand, assets: {}, variants: {}, verificationStatus: 'unresolved', notes: [] };
    return {
      ...brand,
      assets: Object.fromEntries(Object.entries(previous.assets ?? {}).map(([role, asset]) => [role, rewrite(asset)])),
      variants: Object.fromEntries(Object.entries(previous.variants ?? {}).map(([role, values]) => [role, values.map(rewrite)])),
      lastCheckedAt: previous.lastCheckedAt,
      verificationStatus: previous.verificationStatus,
      notes: previous.notes ?? [],
      seededFrom: 'major-brands-100-v1',
    };
  });
  const result = {
    schemaVersion: 2, libraryId: sourceRegistry.libraryId,
    generatedAt: new Date().toISOString(), seededFrom: 'major-brands-100-v1',
    brands: all,
  };
  await writeJson(manifestPath, result);
  console.log(`Bootstrapped ${all.length} identities; ${all.filter(x => Object.keys(x.assets ?? {}).length).length} retain approved assets.`);
}

if (command === 'refresh') await refresh();
else if (command === 'supplement') await supplement();
else if (command === 'curate') await curate();
else if (command === 'approve') await approve();
else if (command === 'verify') await verify();
else if (command === 'coverage') await coverage();
else if (command === 'withdraw') await withdraw();
else if (command === 'restore') await restore();
else if (command === 'review') await review();
else if (command === 'self-test') await selfTest();
else if (command === 'bootstrap') await bootstrap();
else throw new Error('Usage: node scripts/brand-library.mjs refresh|supplement|curate|approve|withdraw|restore|verify|coverage|review|self-test|bootstrap');
