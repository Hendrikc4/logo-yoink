#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractLogos } from '../src/extractor.mjs';
import { RANKING_VERSION, SOURCE_WEIGHT } from '../src/rank.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = join(ROOT, 'fixtures', 'companies-500.json');
const HOLDOUT_SEED = 'logo-yoink-holdout-v1';
const SCHEMA_VERSION = 1;
const REACHABLE = new Set(['live_html', 'redirected_off_domain']);
const ROLE_NAMES = ['icon', 'wide', 'favicon'];
const DEFAULT_EFFICIENCY_THRESHOLDS = {
  p95_latency_ms: { full_points_at_or_below: 5_000, zero_points_at_or_above: 20_000 },
  mean_requests_per_domain: { full_points_at_or_below: 8, zero_points_at_or_above: 30 },
  mean_downloaded_bytes_per_domain: { full_points_at_or_below: 1_000_000, zero_points_at_or_above: 8_000_000 },
};

function help() {
  return `Logo Yoink benchmark

Run a cohort:
  node scripts/benchmark.mjs --cohort original-100 [options]

Compare two completed runs:
  node scripts/benchmark.mjs compare --before runs/a --after runs/b [--output comparison.json]

Score an existing run with reviewer labels:
  node scripts/benchmark.mjs score --run runs/a --labels review.jsonl [--output summary-labeled.json]

Run options:
  --cohort NAME         original-100, holdout-100, remaining-300, or all-500
  --output DIR          Run directory (default: runs/<UTC timestamp>-<cohort>)
  --concurrency N       Domains processed concurrently (default: 4)
  --timeout-ms N        Per-request extractor timeout (default: 10000)
  --limit N             Deterministic prefix, useful for smoke tests
  --besticon-url URL    Optional self-hosted Besticon endpoint
  --compare-run PATH    Add stability comparison against an earlier run
  --labels PATH         Reviewer labels JSONL; enables the 0-100 quality score
  --user-agent TEXT     Recorded in config; forwarded when extractor supports it
  --browser             Enable extractor browser fallback when supported
  --expanded-pages N    Bounded extra pages when supported (default: 0)
  --role-budget         Reserve the fixed download budget by candidate role (default off)
  --content-bounding-wide
                        Use bounded content boxes for wide-role ranking only (default off)
  --help

The run directory receives config.json, results.jsonl, summary.json, assets/, and
failures.csv. Asset bytes are content-addressed and data URLs never enter JSONL.`;
}

export function parseArgs(argv) {
  const args = [...argv];
  const command = ['compare', 'score'].includes(args[0]) ? args.shift() : 'run';
  const options = { command };
  const booleans = new Set(['browser', 'help', 'role-budget', 'content-bounding-wide']);
  for (let index = 0; index < args.length; index++) {
    const raw = args[index];
    if (!raw.startsWith('--')) throw new Error(`Unexpected argument: ${raw}`);
    const [rawKey, inline] = raw.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
    if (booleans.has(rawKey)) options[key] = inline === undefined ? true : inline !== 'false';
    else {
      const value = inline ?? args[++index];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${rawKey}`);
      options[key] = value;
    }
  }
  for (const key of ['concurrency', 'timeoutMs', 'limit', 'expandedPages']) {
    if (options[key] !== undefined) {
      options[key] = Number(options[key]);
      if (!Number.isInteger(options[key]) || options[key] < (key === 'expandedPages' ? 0 : 1)) {
        throw new Error(`--${key.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)} must be a valid integer.`);
      }
    }
  }
  return options;
}

function seededRank(entityId) {
  return createHash('sha256').update(`${HOLDOUT_SEED}\0${entityId}`).digest('hex');
}

export function selectCohort(companies, cohortName) {
  const original = companies.filter(company => company.cohort === 'original-100');
  const additional = companies.filter(company => company.cohort === 'additional-400');
  const rankedAdditional = [...additional].sort((a, b) => seededRank(a.entity_id).localeCompare(seededRank(b.entity_id)) || a.entity_id.localeCompare(b.entity_id));
  const holdoutIds = new Set(rankedAdditional.slice(0, 100).map(company => company.entity_id));
  switch (cohortName) {
    case 'original-100': return original;
    case 'holdout-100': return companies.filter(company => holdoutIds.has(company.entity_id));
    case 'remaining-300': return companies.filter(company => company.cohort === 'additional-400' && !holdoutIds.has(company.entity_id));
    case 'all-500': return companies;
    default: throw new Error(`Unknown cohort '${cohortName}'. Expected original-100, holdout-100, remaining-300, or all-500.`);
  }
}

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function gitRevision() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function extensionFor(candidate, mimeType) {
  const format = String(candidate.format ?? '').toLowerCase().replace('jpeg', 'jpg');
  if (/^(png|jpg|gif|webp|avif|ico|svg)$/.test(format)) return format;
  const mime = String(mimeType ?? candidate.mimeType ?? '').split(';')[0].toLowerCase();
  return ({
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
    'image/avif': 'avif', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/svg+xml': 'svg',
  })[mime] ?? 'bin';
}

function decodeDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) return null;
  const comma = value.indexOf(',');
  if (comma < 0) return null;
  const header = value.slice(5, comma);
  const mimeType = header.split(';')[0] || 'application/octet-stream';
  const encoded = value.slice(comma + 1);
  try {
    return { mimeType, bytes: header.split(';').includes('base64') ? Buffer.from(encoded, 'base64') : Buffer.from(decodeURIComponent(encoded)) };
  } catch {
    return null;
  }
}

function stableCandidateId(entityId, candidate, hash = '') {
  const identity = hash || candidate.resolvedUrl || candidate.resolved_url || candidate.url || JSON.stringify(candidate);
  return createHash('sha256').update(`${entityId}\0${identity}\0${candidate.source ?? ''}`).digest('hex').slice(0, 16);
}

function inferRoles(candidate) {
  const explicit = candidate.roles ?? candidate.predictedRoles ?? candidate.predicted_roles;
  if (Array.isArray(explicit)) return [...new Set(explicit.filter(role => ROLE_NAMES.includes(role)))];
  const roleScores = candidate.roleScores ?? candidate.role_scores;
  if (roleScores && typeof roleScores === 'object') {
    const roles = ROLE_NAMES.filter(role => Number(roleScores[role]) > 0);
    if (roles.length) return roles;
  }
  const roles = [];
  const width = Number(candidate.width ?? candidate.observed?.width);
  const height = Number(candidate.height ?? candidate.observed?.height);
  const ratio = width > 0 && height > 0 ? width / height : null;
  if (candidate.squareish === true || (ratio !== null && ratio >= 0.75 && ratio <= 1.33)) roles.push('icon');
  if (ratio !== null && ratio >= 1.5) roles.push('wide');
  if (['manifest', 'apple', 'html-icon', 'besticon', 'root-favicon', 'mask-icon', 'ms-tile'].includes(candidate.source)) roles.push('favicon');
  return [...new Set(roles)];
}

function normalizedScore(candidate, role) {
  const scores = candidate.roleScores ?? candidate.role_scores;
  return Number(scores?.[role] ?? candidate.score ?? 0);
}

export async function sanitizeCandidate(candidate, entityId, assetsDirectory) {
  const output = { ...candidate };
  delete output.dataUrl;
  delete output.data_url;
  delete output.buffer;
  delete output.body;
  const decoded = decodeDataUrl(candidate.dataUrl ?? candidate.data_url);
  let contentHash = candidate.contentHash ?? candidate.content_hash ?? candidate.observed?.byte_hash ?? null;
  let assetPath = candidate.assetPath ?? candidate.asset_path ?? null;
  if (decoded?.bytes.length) {
    contentHash = createHash('sha256').update(decoded.bytes).digest('hex');
    const extension = extensionFor(candidate, decoded.mimeType);
    const filename = `${contentHash}.${extension}`;
    const target = join(assetsDirectory, filename);
    if (!existsSync(target)) {
      await writeFile(target, decoded.bytes, { flag: 'wx' }).catch(error => {
        if (error.code !== 'EEXIST') throw error;
      });
    }
    assetPath = `assets/${filename}`;
  }
  output.content_hash = contentHash;
  output.asset_path = assetPath;
  output.candidate_id = stableCandidateId(entityId, candidate, contentHash);
  output.predicted_roles = inferRoles(candidate);
  return output;
}

function hostnameFor(value) {
  try { return new URL(/^https?:/i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

function relatedHost(a, b) {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function classifyFailure(error) {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  if (/enotfound|eai_again|dns|certificate|cert_|tls|ssl|self[- ]signed|hostname.*match/.test(message)) return 'dns_tls_failure';
  if (/403|429|captcha|cloudflare|access denied|forbidden|bot|interstitial|blocked/.test(message)) return 'blocked_interstitial';
  if (/content[- ]type|non[- ]html|expected html|unsupported media/.test(message)) return 'non_html';
  if (/parked|for sale|buy this domain/.test(message)) return 'parked_for_sale';
  return 'unknown_failure';
}

function classifySuccess(company, extraction) {
  const explicit = extraction.reachability ?? extraction.diagnostics?.reachability;
  if (typeof explicit === 'string') return explicit;
  if (explicit && typeof explicit.category === 'string') return explicit.category;
  const inputHost = hostnameFor(company.website);
  const finalHost = hostnameFor(extraction.homepage ?? extraction.finalUrl ?? extraction.final_url ?? '');
  return finalHost && inputHost && !relatedHost(inputHost, finalHost) ? 'redirected_off_domain' : 'live_html';
}

function selectedByRole(candidates, extraction) {
  const explicit = extraction.selectedByRole ?? extraction.selected_by_role ?? {};
  const result = {};
  for (const role of ROLE_NAMES) {
    const specified = explicit[role];
    if (specified) {
      const match = candidates.find(candidate => candidate.candidate_id === specified.candidate_id ||
        candidate.url === specified.url || candidate.content_hash === (specified.contentHash ?? specified.content_hash));
      if (match) { result[role] = match.candidate_id; continue; }
    }
    const candidatesForRole = candidates.filter(candidate => candidate.predicted_roles.includes(role));
    candidatesForRole.sort((a, b) => normalizedScore(b, role) - normalizedScore(a, role));
    result[role] = candidatesForRole[0]?.candidate_id ?? null;
  }
  return result;
}

function matchCandidate(candidates, specified) {
  if (!specified) return null;
  return candidates.find(candidate => candidate.candidate_id === specified.candidate_id ||
    candidate.url === specified.url || candidate.content_hash === (specified.contentHash ?? specified.content_hash)) ?? null;
}

async function runCompany(company, extractorOptions, assetsDirectory) {
  const startedAt = performance.now();
  try {
    const extraction = await extractLogos(company.website, extractorOptions);
    const candidates = await Promise.all((extraction.candidates ?? []).map(candidate => sanitizeCandidate(candidate, company.entity_id, assetsDirectory)));
    const legacySelected = matchCandidate(candidates, extraction.selected);
    return {
      schema_version: SCHEMA_VERSION,
      entity_id: company.entity_id,
      name: company.name,
      website: company.website,
      fixture_cohort: company.cohort,
      status: 'success',
      reachability: classifySuccess(company, extraction),
      domain: extraction.domain ?? hostnameFor(company.website),
      homepage: extraction.homepage ?? extraction.finalUrl ?? extraction.final_url ?? null,
      selected_by_role: selectedByRole(candidates, extraction),
      legacy_selected_candidate_id: legacySelected?.candidate_id ?? null,
      candidates,
      diagnostics: extraction.diagnostics ?? {},
      metrics: {
        duration_ms: Math.round(performance.now() - startedAt),
        requests: extraction.diagnostics?.requests ?? null,
        downloaded_bytes: extraction.diagnostics?.downloadedBytes ?? extraction.diagnostics?.downloaded_bytes ??
          (candidates.some(candidate => Number.isFinite(candidate.bytes)) ? candidates.reduce((sum, candidate) => sum + (Number(candidate.bytes) || 0), 0) : null),
        browser_used: extraction.diagnostics?.browserUsed ?? extraction.diagnostics?.browser_used ?? false,
      },
    };
  } catch (error) {
    return {
      schema_version: SCHEMA_VERSION,
      entity_id: company.entity_id,
      name: company.name,
      website: company.website,
      fixture_cohort: company.cohort,
      status: 'failure',
      reachability: classifyFailure(error),
      error: { name: error?.name ?? 'Error', message: String(error?.message ?? error) },
      selected_by_role: Object.fromEntries(ROLE_NAMES.map(role => [role, null])),
      legacy_selected_candidate_id: null,
      candidates: [],
      diagnostics: {},
      metrics: { duration_ms: Math.round(performance.now() - startedAt), requests: null, downloaded_bytes: null, browser_used: false },
    };
  }
}

async function mapConcurrent(items, concurrency, mapper, onResult = () => {}) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index], index);
      await onResult(output[index], index);
    }
  }));
  return output;
}

function percentile(values, fraction) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  return finite[Math.max(0, Math.ceil(fraction * finite.length) - 1)];
}

function rate(numerator, denominator) {
  return denominator ? Math.round(numerator / denominator * 10_000) / 100 : null;
}

function metricAggregate(values) {
  const finite = values.filter(Number.isFinite);
  return {
    available: finite.length,
    total: finite.length ? finite.reduce((sum, value) => sum + value, 0) : null,
    mean: finite.length ? Math.round(finite.reduce((sum, value) => sum + value, 0) / finite.length * 10) / 10 : null,
    p50: percentile(finite, 0.5),
    p95: percentile(finite, 0.95),
  };
}

function reviewerStateValue(value) {
  if (value && typeof value === 'object') {
    const entries = ['light', 'dark'].map(key => reviewerStateValue(value[key])).filter(Number.isFinite);
    return entries.length ? entries.reduce((sum, item) => sum + item, 0) / entries.length : null;
  }
  if (typeof value === 'number') return Math.max(0, Math.min(1, value));
  return ({ good: 1, conditional: 0.5, unusable: 0 })[String(value ?? '').toLowerCase()] ?? null;
}

function flattenLabels(records) {
  const labels = new Map();
  for (const record of records ?? []) {
    const candidates = Array.isArray(record.candidates) ? record.candidates : [record];
    for (const candidate of candidates) {
      const candidateId = candidate.candidate_id ?? candidate.candidateId;
      if (!record.entity_id || !candidateId) continue;
      const label = { ...candidate, entity_id: record.entity_id, candidate_id: candidateId };
      for (const role of labelRoles(label)) labels.set(`${record.entity_id}\0${candidateId}\0${role}`, label);
    }
  }
  return labels;
}

function labelRoles(label) {
  const raw = label?.roles ?? label?.role;
  return (Array.isArray(raw) ? raw : [raw]).filter(role => ROLE_NAMES.includes(role));
}

function identityCorrect(label) {
  return String(label?.identity ?? '').toLowerCase() === 'correct';
}

function identityWrong(label) {
  return ['wrong', 'wrong-brand', 'wrong_brand'].includes(String(label?.identity ?? '').toLowerCase());
}

function efficiencyFraction(value, threshold) {
  if (!Number.isFinite(value)) return null;
  const full = threshold.full_points_at_or_below;
  const zero = threshold.zero_points_at_or_above;
  if (value <= full) return 1;
  if (value >= zero) return 0;
  return (zero - value) / (zero - full);
}

function qualityScore(results, labelRecords, performance, thresholds) {
  const labels = flattenLabels(labelRecords);
  const reachable = results.filter(result => REACHABLE.has(result.reachability));
  const selectedForReview = reachable.flatMap(result => ['icon', 'wide'].flatMap(role =>
    result.selected_by_role?.[role] ? [{ result, role, candidateId: result.selected_by_role[role] }] : []));
  const labeledSelections = selectedForReview.filter(item => labels.has(`${item.result.entity_id}\0${item.candidateId}\0${item.role}`));
  const reviewComplete = labeledSelections.length === selectedForReview.length;
  const roleComponents = {};
  for (const role of ['icon', 'wide']) {
    let covered = 0, topCorrect = 0, usabilityTotal = 0;
    for (const result of reachable) {
      const candidates = result.candidates ?? [];
      const labelsForRole = candidates.map(candidate => ({ candidate, label: labels.get(`${result.entity_id}\0${candidate.candidate_id}\0${role}`) }))
        .filter(item => identityCorrect(item.label) && labelRoles(item.label).includes(role));
      if (labelsForRole.some(item => (reviewerStateValue(item.label.usability) ?? 0) > 0)) covered++;
      const selectedId = result.selected_by_role?.[role];
      const selectedLabel = labels.get(`${result.entity_id}\0${selectedId}\0${role}`);
      const correct = identityCorrect(selectedLabel) && labelRoles(selectedLabel).includes(role);
      if (correct) topCorrect++;
      usabilityTotal += correct ? (reviewerStateValue(selectedLabel.usability) ?? 0) : 0;
    }
    roleComponents[role] = {
      denominator: reachable.length,
      coverage: { numerator: covered, rate: reachable.length ? covered / reachable.length : null },
      top1_correctness: { numerator: topCorrect, rate: reachable.length ? topCorrect / reachable.length : null },
      top1_visual_usability: { weighted_numerator: Math.round(usabilityTotal * 1000) / 1000, rate: reachable.length ? usabilityTotal / reachable.length : null },
    };
  }
  let wrongBrandDomains = 0;
  for (const result of reachable) {
    if (['icon', 'wide'].some(role => identityWrong(labels.get(`${result.entity_id}\0${result.selected_by_role?.[role]}\0${role}`)))) wrongBrandDomains++;
  }
  const wrongBrandRate = reachable.length ? wrongBrandDomains / reachable.length : null;
  const safetyFraction = wrongBrandRate === null ? 0 : Math.max(0, 1 - wrongBrandRate / 0.1);
  const efficiencyInputs = {
    p95_latency_ms: performance.duration_ms.p95,
    mean_requests_per_domain: performance.requests.mean,
    mean_downloaded_bytes_per_domain: performance.downloaded_bytes.mean,
  };
  const efficiencyFractions = Object.fromEntries(Object.entries(efficiencyInputs).map(([key, value]) =>
    [key, { value, fraction: efficiencyFraction(value, thresholds[key]), threshold: thresholds[key] }]));
  const availableEfficiency = Object.values(efficiencyFractions).map(item => item.fraction).filter(Number.isFinite);
  const efficiencyRate = availableEfficiency.length ? availableEfficiency.reduce((sum, value) => sum + value, 0) / availableEfficiency.length : 0;
  const points = {
    coverage: 15 * (roleComponents.icon.coverage.rate ?? 0) + 15 * (roleComponents.wide.coverage.rate ?? 0),
    top1_correctness: 15 * (roleComponents.icon.top1_correctness.rate ?? 0) + 15 * (roleComponents.wide.top1_correctness.rate ?? 0),
    visual_usability: 10 * (roleComponents.icon.top1_visual_usability.rate ?? 0) + 10 * (roleComponents.wide.top1_visual_usability.rate ?? 0),
    safety: 10 * safetyFraction,
    efficiency: 10 * efficiencyRate,
  };
  const roundedPoints = Object.fromEntries(Object.entries(points).map(([key, value]) => [key, Math.round(value * 100) / 100]));
  return {
    value: reviewComplete ? Math.round(Object.values(points).reduce((sum, value) => sum + value, 0) * 100) / 100 : null,
    max: 100,
    status: reviewComplete ? 'complete' : 'incomplete',
    formula: 'coverage 30 + top-1 correctness 30 + visual usability 20 + wrong-brand safety 10 + efficiency 10',
    points: roundedPoints,
    role_components: roleComponents,
    safety: { wrong_brand_domains: wrongBrandDomains, denominator: reachable.length, wrong_brand_rate: wrongBrandRate, scoring: '10 points at 0%; linear to 0 points at >=10%' },
    efficiency: { rate: efficiencyRate, available_inputs: availableEfficiency.length, inputs: efficiencyFractions, scoring: 'Mean of available linearly normalized inputs; missing inputs are disclosed and excluded.' },
    labels: { records: labelRecords.length, role_labels: labels.size, selected_roles: selectedForReview.length, selected_roles_labeled: labeledSelections.length, complete: reviewComplete },
  };
}

export function summarizeResults(results, metadata = {}, labelRecords = null, efficiencyThresholds = DEFAULT_EFFICIENCY_THRESHOLDS) {
  const taxonomy = {};
  for (const result of results) taxonomy[result.reachability] = (taxonomy[result.reachability] ?? 0) + 1;
  const reachable = results.filter(result => REACHABLE.has(result.reachability));
  const roles = {};
  for (const role of ROLE_NAMES) {
    const withCandidate = results.filter(result => result.candidates.some(candidate => candidate.predicted_roles?.includes(role)));
    const reachableWithCandidate = withCandidate.filter(result => REACHABLE.has(result.reachability));
    const candidateCount = results.reduce((sum, result) => sum + result.candidates.filter(candidate => candidate.predicted_roles?.includes(role)).length, 0);
    roles[role] = {
      domains: withCandidate.length,
      candidates: candidateCount,
      all_domain_rate_pct: rate(withCandidate.length, results.length),
      reachable_domain_rate_pct: rate(reachableWithCandidate.length, reachable.length),
    };
  }
  const coverageComponents = { icon: roles.icon.domains, wide: roles.wide.domains, favicon: roles.favicon.domains };
  const automatedProxyScore = results.length ? Math.round((coverageComponents.icon * 0.4 + coverageComponents.wide * 0.4 + coverageComponents.favicon * 0.2) / results.length * 1000) / 10 : 0;
  const performance = {
    duration_ms: metricAggregate(results.map(result => result.metrics?.duration_ms)),
    requests: metricAggregate(results.map(result => result.metrics?.requests)),
    downloaded_bytes: metricAggregate(results.map(result => result.metrics?.downloaded_bytes)),
    browser_invocations: results.filter(result => result.metrics?.browser_used).length,
  };
  const legacySelected = results.map(result => result.candidates.find(candidate => candidate.candidate_id === result.legacy_selected_candidate_id)).filter(Boolean);
  const summary = {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    ...metadata,
    domains: { total: results.length, reachable: reachable.length, successful_extractions: results.filter(result => result.status === 'success').length },
    reachability_taxonomy: taxonomy,
    roles,
    any_candidate: {
      domains: results.filter(result => result.candidates.length).length,
      all_domain_rate_pct: rate(results.filter(result => result.candidates.length).length, results.length),
    },
    automatedProxyScore: {
      value: automatedProxyScore,
      max: 100,
      formula: '40% icon domain coverage + 40% wide domain coverage + 20% favicon domain coverage, all-domain denominator',
      caveat: 'Availability proxy, not a quality score. Correctness and visual usability require reviewer labels.',
    },
    historical_comparison_proxy: {
      valid_selected: { numerator: legacySelected.length, denominator: results.length, rate_pct: rate(legacySelected.length, results.length) },
      square_and_high_resolution_selected: {
        numerator: legacySelected.filter(candidate => candidate.squareish && candidate.highResolution).length,
        denominator: results.length,
        rate_pct: rate(legacySelected.filter(candidate => candidate.squareish && candidate.highResolution).length, results.length),
        definition: 'Legacy global selected candidate is squareish and highResolution; retained only for historical comparison.',
      },
    },
    performance,
  };
  summary.benchmarkScore = labelRecords ? qualityScore(results, labelRecords, performance, efficiencyThresholds) : null;
  return summary;
}

async function readJsonl(path) {
  const text = await readFile(path, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`Invalid JSON on ${path}:${index + 1}: ${error.message}`); }
  });
}

function resolveResultsPath(value) {
  const absolute = resolve(value);
  return extname(absolute) === '.jsonl' ? absolute : join(absolute, 'results.jsonl');
}

function outcomeSignature(result) {
  return JSON.stringify({
    status: result.status,
    reachability: result.reachability,
    selected: result.selected_by_role ?? {},
    roles: Object.fromEntries(ROLE_NAMES.map(role => [role, Boolean(result.candidates?.some(candidate => candidate.predicted_roles?.includes(role)))])),
  });
}

export function compareResults(before, after) {
  const left = new Map(before.map(result => [result.entity_id, result]));
  const right = new Map(after.map(result => [result.entity_id, result]));
  const ids = [...new Set([...left.keys(), ...right.keys()])].sort();
  const changes = [];
  let flips = 0;
  for (const entityId of ids) {
    const a = left.get(entityId);
    const b = right.get(entityId);
    const changed = !a || !b || outcomeSignature(a) !== outcomeSignature(b);
    if (changed) flips++;
    const roleChanges = {};
    for (const role of ROLE_NAMES) {
      const beforeAvailable = Boolean(a?.candidates?.some(candidate => candidate.predicted_roles?.includes(role)));
      const afterAvailable = Boolean(b?.candidates?.some(candidate => candidate.predicted_roles?.includes(role)));
      roleChanges[role] = beforeAvailable === afterAvailable ? 'same' : afterAvailable ? 'gain' : 'loss';
    }
    if (changed) changes.push({
      entity_id: entityId,
      name: b?.name ?? a?.name ?? null,
      website: b?.website ?? a?.website ?? null,
      before: a ? { status: a.status, reachability: a.reachability, selected_by_role: a.selected_by_role } : null,
      after: b ? { status: b.status, reachability: b.reachability, selected_by_role: b.selected_by_role } : null,
      role_changes: roleChanges,
    });
  }
  return {
    schema_version: SCHEMA_VERSION,
    compared_at: new Date().toISOString(),
    before_domains: before.length,
    after_domains: after.length,
    shared_domains: ids.filter(id => left.has(id) && right.has(id)).length,
    flip_count: flips,
    stable_count: ids.length - flips,
    flip_rate_pct: rate(flips, ids.length),
    role_availability: Object.fromEntries(ROLE_NAMES.map(role => {
      let gains = 0, losses = 0;
      for (const change of changes) {
        if (change.role_changes[role] === 'gain') gains++;
        if (change.role_changes[role] === 'loss') losses++;
      }
      return [role, { gains, losses, net: gains - losses }];
    })),
    changes,
  };
}

async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, path);
}

function csvCell(value) {
  const string = String(value ?? '');
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

async function compareCommand(options) {
  if (!options.before || !options.after) throw new Error('compare requires --before and --after.');
  const comparison = compareResults(await readJsonl(resolveResultsPath(options.before)), await readJsonl(resolveResultsPath(options.after)));
  const json = `${JSON.stringify(comparison, null, 2)}\n`;
  if (options.output) await writeAtomic(resolve(options.output), json);
  else process.stdout.write(json);
}

async function scoreCommand(options) {
  if (!options.run || !options.labels) throw new Error('score requires --run and --labels.');
  const runDirectory = resolve(options.run);
  const [results, labels, existing] = await Promise.all([
    readJsonl(resolveResultsPath(runDirectory)),
    readJsonl(resolve(options.labels)),
    readFile(join(runDirectory, 'summary.json'), 'utf8').then(JSON.parse),
  ]);
  const summary = summarizeResults(results, {
    run_id: existing.run_id ?? basename(runDirectory), cohort: existing.cohort ?? null,
    wall_time_ms: existing.wall_time_ms ?? null, repeat_comparison: existing.repeat_comparison ?? null,
  }, labels);
  const target = resolve(options.output ?? join(runDirectory, 'summary-labeled.json'));
  await writeAtomic(target, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${target}\n${summary.benchmarkScore.status === 'complete' ? `benchmark score ${summary.benchmarkScore.value}/100` : `incomplete review ${summary.benchmarkScore.labels.selected_roles_labeled}/${summary.benchmarkScore.labels.selected_roles} selected roles labeled`}\n`);
}

async function runCommand(options) {
  const cohort = options.cohort ?? 'original-100';
  const concurrency = options.concurrency ?? 4;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
  let companies = selectCohort(fixture.companies, cohort);
  if (options.limit) companies = companies.slice(0, options.limit);
  const outputDirectory = resolve(options.output ?? join(ROOT, 'runs', `${timestampId()}-${cohort}`));
  const assetsDirectory = join(outputDirectory, 'assets');
  await mkdir(assetsDirectory, { recursive: true });
  const config = {
    schema_version: SCHEMA_VERSION,
    run_id: basename(outputDirectory),
    created_at: new Date().toISOString(),
    git_revision: gitRevision(),
    fixture: 'fixtures/companies-500.json',
    fixture_generated_at: fixture.generatedAt ?? null,
    cohort,
    cohort_count: companies.length,
    cohort_entity_ids: companies.map(company => company.entity_id),
    holdout_seed: HOLDOUT_SEED,
    options: {
      concurrency, timeout_ms: timeoutMs, besticon_enabled: Boolean(options.besticonUrl),
      browser: Boolean(options.browser), expanded_pages: options.expandedPages ?? 0,
      role_budget: Boolean(options.roleBudget), content_bounding_wide: Boolean(options.contentBoundingWide),
      user_agent: options.userAgent ?? 'extractor default',
    },
    efficiency_thresholds: DEFAULT_EFFICIENCY_THRESHOLDS,
    ranking: { version: RANKING_VERSION, source_weights: SOURCE_WEIGHT, role_score_threshold: 35 },
  };
  await writeAtomic(join(outputDirectory, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  const lines = new Array(companies.length);
  let completed = 0;
  const startedAt = performance.now();
  let browserInstance = null;
  if (options.browser) {
    const playwright = await import('playwright');
    browserInstance = await playwright.chromium.launch({ headless: true });
    config.options.browser_engine_version = browserInstance.version();
    await writeAtomic(join(outputDirectory, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  }
  const extractorOptions = {
    timeoutMs,
    companyName: undefined,
    besticonUrl: options.besticonUrl,
    browser: Boolean(options.browser),
    expandedPages: options.expandedPages ?? 0,
    roleAwareBudget: Boolean(options.roleBudget),
    contentBoundingWide: Boolean(options.contentBoundingWide),
    userAgent: options.userAgent,
    browserInstance,
  };
  let results;
  try {
    results = await mapConcurrent(companies, concurrency,
      company => runCompany(company, { ...extractorOptions, companyName: company.name }, assetsDirectory),
      async (result, index) => {
        lines[index] = JSON.stringify(result);
        completed++;
        process.stderr.write(`\r${completed}/${companies.length} ${result.status === 'success' ? 'ok' : result.reachability}   `);
      });
  } finally {
    await browserInstance?.close();
  }
  if (companies.length) process.stderr.write('\n');
  await writeAtomic(join(outputDirectory, 'results.jsonl'), `${lines.join('\n')}\n`);
  let comparison = null;
  if (options.compareRun) comparison = compareResults(await readJsonl(resolveResultsPath(options.compareRun)), results);
  const labelRecords = options.labels ? await readJsonl(resolve(options.labels)) : null;
  const summary = summarizeResults(results, {
    run_id: config.run_id,
    cohort,
    wall_time_ms: Math.round(performance.now() - startedAt),
    repeat_comparison: comparison,
  }, labelRecords, config.efficiency_thresholds);
  await writeAtomic(join(outputDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const failures = results.filter(result => result.status === 'failure' || result.reachability !== 'live_html');
  const failureCsv = ['entity_id,name,website,status,reachability,error', ...failures.map(result =>
    [result.entity_id, result.name, result.website, result.status, result.reachability, result.error?.message].map(csvCell).join(','))].join('\n');
  await writeAtomic(join(outputDirectory, 'failures.csv'), `${failureCsv}\n`);
  process.stdout.write(`${outputDirectory}\n`);
  const score = summary.benchmarkScore ? `benchmark score ${summary.benchmarkScore.value}/100` : `automated availability proxy ${summary.automatedProxyScore.value}/100`;
  process.stdout.write(`${score}; icon ${summary.roles.icon.domains}, wide ${summary.roles.wide.domains}, favicon ${summary.roles.favicon.domains} of ${summary.domains.total}\n`);
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { process.stdout.write(`${help()}\n`); return; }
    if (options.command === 'compare') await compareCommand(options);
    else if (options.command === 'score') await scoreCommand(options);
    else await runCommand(options);
  } catch (error) {
    process.stderr.write(`benchmark: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
