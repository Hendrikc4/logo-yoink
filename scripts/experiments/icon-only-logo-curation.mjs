#!/usr/bin/env node
// Task-scoped helper for staging already-captured, visually reviewable logo
// candidates from a brand-library run. It does not discover new URLs.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import sharp from 'sharp';
import { inspectRemoteZip } from '../../src/discover-deep.mjs';
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
const gapReportPath = option('--write-gap-report');
const selectedReviewPath = option('--approve-selected');
const selectedHistoryPath = option('--selected-history');
const syncApproved = args.includes('--sync-approved');
if (!runId || (!planPath && !normalizeOnly && !decisionsConfigPath && !restorationsPath && !gapReportPath && !selectedReviewPath && !syncApproved)) {
  throw new Error('Usage: node scripts/experiments/icon-only-logo-curation.mjs --root ROOT --run RUN_ID (--plan PLAN.json | --normalize-only | --write-decisions CONFIG.json | --write-restorations FILE.json | --write-gap-report FILE.json | --approve-selected DECISIONS.json | --sync-approved)');
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const writeJson = async (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const reportPath = resolve(root, 'runs', runId, 'report.json');
const report = await readJson(reportPath);
const planDocument = planPath ? await readJson(resolve(planPath)) : { records: [] };
const plan = planDocument.stagingPlan ?? planDocument;
const byId = new Map(report.records.map(record => [record.brand.id, record]));
const themeOverrides = new Map(plan.records.filter(entry => entry.theme).map(entry => [entry.brandId, entry.theme]));

const decodeDataUrl = value => {
  const match = String(value).match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) return null;
  return match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
};

async function fetchResource(url, { headers = {}, maxBytes = 3 * 1024 * 1024 } = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'LogoYoinkBrandLibrary/1.0 (captured-candidate review)', ...headers },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes.`);
  return { bytes, url: response.url, status: response.status, headers: response.headers };
}

async function download(candidate, companyName) {
  const url = candidate.url;
  const inline = decodeDataUrl(url);
  if (inline) return { bytes: inline, resolvedUrl: url };
  if (url.startsWith('zip+')) {
    const separator = url.indexOf('#');
    const archiveUrl = url.slice(4, separator);
    const member = decodeURIComponent(url.slice(separator + 1));
    const inspected = await inspectRemoteZip(archiveUrl, {
      fetchResource,
      companyName,
      context: candidate.evidence?.semantic_text ?? member,
      chain: candidate.provenance_chain ?? [],
    });
    const match = inspected.candidates.find(item => item.evidence?.archive_member === member);
    if (!match?.rawBytes) throw new Error(`Archive member was not selected: ${member}`);
    return { bytes: match.rawBytes, resolvedUrl: url };
  }
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

const prefetched = new Map();
const externalEntries = normalizeOnly || selectedReviewPath ? [] : plan.records.filter(entry => entry.external);
for (let start = 0; start < externalEntries.length; start += 2) {
  const batch = externalEntries.slice(start, start + 2);
  await Promise.all(batch.map(async entry => {
    try {
      prefetched.set(entry.sourceUrl, await download({ url: entry.sourceUrl }, byId.get(entry.brandId)?.brand.name));
    } catch (error) {
      prefetched.set(entry.sourceUrl, error);
    }
  }));
  await new Promise(done => setTimeout(done, 750));
}

const outcomes = [];
for (const entry of normalizeOnly || selectedReviewPath ? [] : plan.records) {
  const record = byId.get(entry.brandId);
  if (!record) throw new Error(`Unknown run brand: ${entry.brandId}`);
  let captured;
  if (entry.external) {
    captured = {
      url: entry.sourceUrl,
      source: entry.source ?? 'external-targeted-search',
      source_page: entry.discoveryPage,
      evidence: { eligible_roles: ['wide'], positive_token: true, semantic_text: entry.commonsTitle ?? entry.sourceUrl },
      provenance_chain: [
        { kind: entry.source ?? 'external-targeted-search', url: entry.discoveryPage ?? entry.sourceUrl },
        ...(entry.originalSourceUrl && entry.originalSourceUrl !== entry.sourceUrl
          ? [{ kind: 'commons-original-file', url: entry.originalSourceUrl }]
          : []),
      ],
    };
  } else {
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
    captured = matches[entry.matchIndex ?? 0];
  }
  try {
    const prefetch = prefetched.get(captured.url);
    if (prefetch instanceof Error) throw prefetch;
    const downloaded = prefetch ?? await download(captured, record.brand.name);
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
      theme: entry.theme ?? honestTheme(validated),
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
  if (!entry.external) await new Promise(done => setTimeout(done, 700));
}

for (const record of report.records) {
  const staged = record.roles.logo?.candidate;
  if (!staged) continue;
  staged.representation ??= representation({}, staged.width, staged.height);
  if (themeOverrides.has(record.brand.id)) staged.theme = themeOverrides.get(record.brand.id);
  try {
    const evidence = await readJson(resolve(root, 'runs', runId, 'evidence', `${record.brand.id}.json`));
    const observed = evidence.assets?.logo?.url === staged.sourceUrl
      ? evidence.assets.logo
      : (evidence.candidates ?? []).find(candidate => candidate.url === staged.sourceUrl);
    if (!observed) continue;
    staged.theme = themeOverrides.get(record.brand.id) ?? honestTheme(observed);
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
if (gapReportPath) {
  const manifest = await readJson(resolve(root, 'manifest.json'));
  const approved = new Map(manifest.brands.map(brand => [brand.id, brand]));
  const gaps = [];
  for (const record of report.records) {
    const brand = approved.get(record.brand.id);
    if (brand?.assets?.logo) continue;
    let evidence = { candidates: [] };
    try {
      evidence = await readJson(resolve(root, 'runs', runId, 'evidence', `${record.brand.id}.json`));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const wideCandidates = (evidence.candidates ?? []).filter(candidate =>
      candidate.evidence?.eligible_roles?.includes('wide'));
    const rejected = record.roles.logo?.status === 'rejected_after_visual_review';
    const category = record.error ? 'blocked_or_unreachable'
      : rejected ? 'rejected_after_visual_review'
        : 'no_verified_company_name_candidate';
    const reason = record.error ?? record.roles.logo?.reviewReason ??
      'Full sweep and targeted saved-candidate pass produced no identity-correct company-name artwork suitable for approval.';
    gaps.push({
      brandId: record.brand.id,
      name: record.brand.name,
      domain: record.brand.domain,
      homepage: record.homepage ?? record.brand.officialHomepage,
      category,
      reason,
      evidenceCandidates: (evidence.candidates ?? []).length,
      wideEvidenceCandidates: wideCandidates.length,
      evidenceFile: `runs/${runId}/evidence/${record.brand.id}.json`,
      nextAction: category === 'blocked_or_unreachable'
        ? 'Retry the official newsroom, investor-relations, or brand-resource host; then check a manually resolved Wikimedia Commons file if the official host remains unavailable.'
        : category === 'rejected_after_visual_review'
          ? 'Do not reuse the rejected asset. Search the official media/brand portal for a current master wordmark or lockup, then use a manually resolved Commons file only if identity and currency can be verified.'
          : 'Run a manual direct asset search against official press/brand pages, followed by a manually resolved Wikimedia Commons candidate if no first-party file is published.',
    });
  }
  const categories = Object.fromEntries([...new Set(gaps.map(row => row.category))].sort().map(category =>
    [category, gaps.filter(row => row.category === category).length]));
  await writeJson(resolve(root, gapReportPath), {
    schemaVersion: 1,
    runId,
    generatedAt: new Date().toISOString(),
    scope: 'Baseline brands that had an approved icon but no approved company-name logo.',
    policy: 'Symbols alone are not counted as company-name logos; no symbol-only exceptions were marked complete.',
    attemptedBrands: report.records.length,
    approvedLogosFromCohort: report.records.filter(record => approved.get(record.brand.id)?.assets?.logo).length,
    remainingGaps: gaps.length,
    categories,
    gaps,
  });
  console.log(JSON.stringify({ gapReport: resolve(root, gapReportPath), remainingGaps: gaps.length, categories }, null, 2));
}
if (selectedReviewPath) {
  if (!planPath) throw new Error('--approve-selected requires --plan.');
  const review = await readJson(resolve(root, selectedReviewPath));
  const rejected = new Map(review.decisions.filter(item => item.action === 'reject' && item.role === 'logo')
    .map(item => [item.brandId, item.reason]));
  const manifestPath = resolve(root, 'manifest.json');
  const manifest = await readJson(manifestPath);
  const approved = new Map(manifest.brands.map(brand => [brand.id, brand]));
  const reviewedBrands = [];
  let approvedCount = 0;
  for (const entry of plan.records) {
    const record = byId.get(entry.brandId);
    const candidate = record?.roles.logo?.candidate;
    if (!candidate) continue;
    const brand = approved.get(entry.brandId);
    if (!brand) throw new Error(`Approved manifest is missing ${entry.brandId}.`);
    if (rejected.has(entry.brandId)) {
      record.roles.logo = { ...record.roles.logo, candidate: null, status: 'rejected_after_visual_review', change: 'missing_unapproved', reviewReason: rejected.get(entry.brandId) };
      brand.notes = [...(brand.notes ?? []), { role: 'logo', kind: 'persistent_role_gap', reason: rejected.get(entry.brandId), reviewedAt: review.reviewedAt }];
    } else {
      brand.assets.logo = { ...candidate, verificationStatus: 'approved_ai_visual_review', lastConfirmedCurrentAt: review.reviewedAt };
      brand.lastCheckedAt = candidate.lastCheckedAt;
      brand.verificationStatus = 'approved_complete';
      approvedCount++;
    }
    reviewedBrands.push(structuredClone(brand));
  }
  report.review = { reviewer: review.reviewer, reviewedAt: review.reviewedAt, decisions: review.decisions.length };
  report.curatedAt = new Date().toISOString();
  report.summary = {
    ...report.summary,
    candidateWordmarks: report.records.filter(record => record.roles.logo?.candidate).length,
  };
  manifest.generatedAt = new Date().toISOString();
  manifest.approvedFromRun = runId;
  await writeJson(reportPath, report);
  await writeJson(manifestPath, manifest);
  const historyPath = resolve(root, selectedHistoryPath ?? `approval-history/${runId}-selected-${manifest.generatedAt.replace(/[:.]/g, '-')}.json`);
  await writeJson(historyPath, {
    schemaVersion: manifest.schemaVersion,
    libraryId: manifest.libraryId,
    generatedAt: manifest.generatedAt,
    approvedFromRun: runId,
    reviewer: review.reviewer,
    reviewedAt: review.reviewedAt,
    decisions: review.decisions,
    brands: reviewedBrands,
  });
  console.log(JSON.stringify({ approvedSelectedLogos: approvedCount, rejectedSelectedLogos: rejected.size, history: historyPath }, null, 2));
}
console.log(JSON.stringify({ staged: outcomes.filter(row => row.status === 'staged').length, failed: outcomes.filter(row => row.status === 'failed').length }, null, 2));
