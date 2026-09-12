#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { discoverSitemapBrandAssets, sameRegistrableDomain } from '../../src/discover-sitemap.mjs';
import { internals as extractorInternals } from '../../src/extractor.mjs';
import { assertPublicUrl, fetchTimed, readLimited } from '../../src/http-client.mjs';
import { mapConcurrent } from '../../src/concurrency.mjs';
import { rankCandidates } from '../../src/rank.mjs';
import { normalizeAssetPreferences } from '../../src/asset-model.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const COHORTS = Object.freeze({
  'major-brands-300': Object.freeze({
    development: join(ROOT, 'benchmarks/major-brands-300-v1/splits/development.jsonl'),
    validation: join(ROOT, 'benchmarks/major-brands-300-v1/splits/validation.jsonl'),
  }),
  'original-500': Object.freeze({
    development: join(ROOT, 'benchmarks/visual-benchmark-v1-500/splits/development.jsonl'),
    validation: join(ROOT, 'benchmarks/visual-benchmark-v1-500/splits/validation.jsonl'),
  }),
});
const DEFAULT_CONTROL = '/Users/hendrik/Documents/logo-yoink/runs/major-brands-v4-cycle/rank-v6-development/results.jsonl';
const DEFAULT_CONTROL_ASSETS = '/Users/hendrik/Documents/logo-yoink/runs/2026-08-24-major-brands-300-stage-2';
const REVIEW_VALUES = new Set(['correct', 'wrong_brand', 'related_brand', 'not_logo', 'ambiguous']);

export const VARIANTS = Object.freeze([
  {
    id: 'robots_strict_1',
    description: 'Robots-declared sitemap only; strong URL semantics; one official page.',
    options: { seedMode: 'robots-only', minPageScore: 80, limits: { maxSitemapDocuments: 3, maxPages: 1, maxCandidates: 4 } },
  },
  {
    id: 'conventional_strict_1',
    description: 'Conventional sitemap paths only; strong URL semantics; one official page.',
    options: { seedMode: 'conventional-only', minPageScore: 80, limits: { maxSitemapDocuments: 3, maxPages: 1, maxCandidates: 4 } },
  },
  {
    id: 'union_strict_1',
    description: 'Robots plus conventional paths; strong URL semantics; one official page.',
    options: { seedMode: 'robots-and-conventional', minPageScore: 80, limits: { maxSitemapDocuments: 3, maxPages: 1, maxCandidates: 4 } },
  },
  {
    id: 'union_balanced_1',
    description: 'Robots plus conventional paths; newsroom/press threshold; one official page.',
    options: { seedMode: 'robots-and-conventional', minPageScore: 55, limits: { maxSitemapDocuments: 3, maxPages: 1, maxCandidates: 4 } },
  },
  {
    id: 'union_balanced_2',
    description: 'Balanced URL semantics with at most two official pages and four sitemap documents.',
    options: { seedMode: 'robots-and-conventional', minPageScore: 55, limits: { maxSitemapDocuments: 4, maxPages: 2, maxCandidates: 4 } },
  },
  {
    id: 'union_fresh_2',
    description: 'Two-page balanced treatment rejecting explicit lastmod values older than five years.',
    options: { seedMode: 'robots-and-conventional', minPageScore: 55, maxAgeDays: 5 * 365, rejectStale: true, limits: { maxSitemapDocuments: 4, maxPages: 2, maxCandidates: 4 } },
  },
  {
    id: 'robots_strict_exact_cdn_1',
    description: 'Robots-declared sitemaps only; one official page may nominate an embedded exact-company-labeled CDN logo.',
    options: {
      seedMode: 'robots-only', minPageScore: 80, assetHostPolicy: 'official-page',
      limits: { maxSitemapDocuments: 3, maxPages: 1, maxCandidates: 4, maxRequests: 12, maxTotalBytes: 5 * 1024 * 1024, maxDurationMs: 16_000 },
    },
  },
  {
    id: 'robots_strict_exact_cdn_2',
    description: 'Robots-declared sitemaps only; strong URL semantics; at most two exact-labeled official pages.',
    options: {
      seedMode: 'robots-only', minPageScore: 80, assetHostPolicy: 'official-page',
      limits: { maxSitemapDocuments: 4, maxPages: 2, maxCandidates: 4, maxRequests: 12, maxTotalBytes: 5 * 1024 * 1024, maxDurationMs: 16_000 },
    },
  },
  {
    id: 'robots_corporate_exact_cdn_1',
    description: 'Robots-declared sitemaps may inspect one corporate/about page under exact asset identity gates.',
    options: {
      seedMode: 'robots-only', minPageScore: 25, assetHostPolicy: 'official-page',
      limits: { maxSitemapDocuments: 3, maxPages: 1, maxCandidates: 4, maxRequests: 12, maxTotalBytes: 5 * 1024 * 1024, maxDurationMs: 16_000 },
    },
  },
  {
    id: 'robots_corporate_exact_cdn_2',
    description: 'Robots-declared sitemaps may inspect two corporate/about pages under exact asset identity gates.',
    options: {
      seedMode: 'robots-only', minPageScore: 25, assetHostPolicy: 'official-page',
      limits: { maxSitemapDocuments: 4, maxPages: 2, maxCandidates: 4, maxRequests: 12, maxTotalBytes: 5 * 1024 * 1024, maxDurationMs: 16_000 },
    },
  },
  {
    id: 'union_strict_exact_cdn_1',
    description: 'Strong sitemap semantics; one official page may nominate an embedded exact-company-labeled CDN logo with redirects pinned to that asset domain.',
    options: {
      seedMode: 'robots-and-conventional', minPageScore: 80, assetHostPolicy: 'official-page',
      limits: { maxSitemapDocuments: 3, maxPages: 1, maxCandidates: 4, maxRequests: 12, maxTotalBytes: 5 * 1024 * 1024, maxDurationMs: 16_000 },
    },
  },
]);

function parseArgs(argv) {
  const options = { control: DEFAULT_CONTROL, controlAssets: [], output: 'runs/sitemap-wide-experiment', concurrency: 3, limit: null, reviews: null, cohort: 'major-brands-300', split: 'development', variant: null };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (raw === '--help') return { help: true };
    if (!raw.startsWith('--')) throw new Error(`Unexpected argument: ${raw}`);
    const key = raw.slice(2).replace(/-([a-z])/g, (_, value) => value.toUpperCase());
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${raw}.`);
    if (key === 'controlAssets') {
      options.controlAssets.push(value);
      continue;
    }
    options[key] = value;
  }
  if (!options.controlAssets.length) options.controlAssets.push(DEFAULT_CONTROL_ASSETS);
  for (const key of ['concurrency', 'limit']) {
    if (options[key] == null) continue;
    options[key] = Number(options[key]);
    if (!Number.isInteger(options[key]) || options[key] < 1) throw new Error(`--${key} must be a positive integer.`);
  }
  if (!Object.hasOwn(COHORTS, options.cohort)) throw new Error(`--cohort must be one of: ${Object.keys(COHORTS).join(', ')}.`);
  if (!Object.hasOwn(COHORTS[options.cohort], options.split)) throw new Error('--split must be development or validation; evaluation is intentionally unsupported.');
  if (options.variant && !VARIANTS.some(item => item.id === options.variant)) throw new Error(`Unknown variant: ${options.variant}`);
  return options;
}

function help() {
  return `Sitemap-wide development experiment

node scripts/experiments/sitemap-wide-experiment.mjs [options]

  --control PATH      Frozen results JSONL covering the selected cohort
  --control-assets PATH  Root containing frozen assets; repeat for a content-addressed union
  --cohort NAME       major-brands-300 (default) or original-500
  --output DIR        Output directory (normally gitignored)
  --concurrency N     Domains processed concurrently (default: 3)
  --limit N           Deterministic prefix for smoke tests
  --reviews PATH      Optional fingerprint-bound proposal verdicts JSONL
  --capture PATH      Record bounded live responses and failures as gzipped JSONL
  --replay PATH       Run without network from a prior gzipped capture
  --split NAME        development (default) or validation; evaluation is unsupported
  --variant ID        Run one frozen treatment only
`;
}

async function readJsonl(path) {
  const text = await readFile(path, 'utf8');
  return text.split('\n').filter(Boolean).map(JSON.parse);
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function headersObject(headers) {
  const sensitive = new Set(['authorization', 'cookie', 'proxy-authenticate', 'proxy-authorization', 'set-cookie', 'www-authenticate']);
  return Object.fromEntries([...headers.entries()].filter(([name]) => !sensitive.has(name.toLowerCase())));
}

function cloneResource(record) {
  return { ...record, headers: new Headers(record.headers), bytes: Buffer.from(record.bytes) };
}

function captureKey(namespace, url, options) {
  // Preserve the schema-v1 key shape so captures from the retry ablation remain replayable.
  return JSON.stringify([namespace, url, options.accept ?? '*/*', options.headers ?? {}, options.attemptKey ?? null]);
}

function cachingResourceFetcher(namespace, captureStore, replayOnly) {
  const cache = new Map();
  return async (url, options = {}) => {
    const key = captureKey(namespace, url, options);
    const existing = cache.get(key) ?? captureStore.get(key);
    if (existing) {
      cache.set(key, existing);
      if (existing.error) {
        const error = new Error(existing.error);
        error.resourceMetrics = existing.resourceMetrics;
        throw error;
      }
      if (existing.bytes.length > options.maxBytes) throw new Error(`Response exceeds ${options.maxBytes} bytes.`);
      return cloneResource(existing);
    }
    if (replayOnly) throw new Error(`Replay capture is missing resource: ${url}`);
    const diagnostics = { requests: 0, bytesDownloaded: 0 };
    const startedAt = performance.now();
    const resourceTimeoutMs = options.timeoutMs ?? 10_000;
    try {
      const response = await fetchTimed(url, {
        timeoutMs: resourceTimeoutMs,
        maxRedirects: options.maxRedirects,
        accept: options.accept,
        headers: options.headers,
        diagnostics,
        validateUrl: options.validateUrl,
      });
      const bodyTimeoutMs = Math.floor(resourceTimeoutMs - (performance.now() - startedAt));
      if (bodyTimeoutMs <= 0) {
        await response.body?.cancel().catch(() => {});
        throw new DOMException('Resource budget expired before the body could be read.', 'AbortError');
      }
      const read = await readLimited(response, options.maxBytes, { diagnostics, timeoutMs: bodyTimeoutMs });
      const record = {
        ok: response.ok,
        status: response.status,
        url: response.url,
        headers: headersObject(response.headers),
        bytes: read.bytes,
        requestCount: diagnostics.requests,
        downloadedBytes: diagnostics.bytesDownloaded,
        durationMs: Math.round(performance.now() - startedAt),
      };
      cache.set(key, record);
      captureStore.set(key, record);
      return cloneResource(record);
    } catch (error) {
      const resourceMetrics = {
        requestCount: diagnostics.requests,
        downloadedBytes: diagnostics.bytesDownloaded,
        durationMs: Math.round(performance.now() - startedAt),
      };
      const record = { error: error.name === 'AbortError' ? 'timeout' : error.message, resourceMetrics };
      cache.set(key, record);
      captureStore.set(key, record);
      error.resourceMetrics = resourceMetrics;
      throw error;
    }
  };
}

function encodeCapture(captureStore) {
  const lines = [JSON.stringify({ schema_version: 1, kind: 'logo-yoink-sitemap-web-capture' })];
  for (const [key, record] of [...captureStore].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(JSON.stringify({
      key,
      record: record.error ? record : { ...record, bytes: undefined, bytes_base64: record.bytes.toString('base64') },
    }));
  }
  return gzipSync(`${lines.join('\n')}\n`, { level: 9 });
}

async function readCapture(path) {
  const compressed = await readFile(path);
  const lines = gunzipSync(compressed).toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
  if (lines.shift()?.kind !== 'logo-yoink-sitemap-web-capture') throw new Error('Invalid sitemap web capture.');
  const store = new Map(lines.map(({ key, record }) => [key, record.error
    ? record
    : { ...record, bytes: Buffer.from(record.bytes_base64, 'base64') }]));
  return { store, sha256: createHash('sha256').update(compressed).digest('hex') };
}

function selectionKey(item) {
  return item?.observed?.byte_hash ?? item?.content_hash ?? item?.resolved_url ?? item?.resolvedUrl ?? item?.url ?? null;
}

function selectedRoleId(ranked, role) {
  const item = ranked.selectedByRole[role];
  return item?.candidate_id ?? selectionKey(item);
}

function proposalFingerprint(proposal) {
  return `sha256:${createHash('sha256').update(JSON.stringify({
    entity_id: proposal.entity_id,
    selected_url: proposal.selected_url,
    content_hash: proposal.content_hash,
    source_page: proposal.source_page,
  })).digest('hex')}`;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}

function errorClass(value) {
  const message = String(value ?? '').toLowerCase();
  const status = message.match(/http\s+(\d{3})/)?.[1];
  if (status) return `http_${status}`;
  if (/timeout|abort/.test(message)) return 'timeout';
  if (/exceeds .* bytes|oversized|byte limit/.test(message)) return 'oversize';
  if (/html/.test(message)) return 'html_not_xml';
  if (/dtd|entity/.test(message)) return 'xml_entity_rejected';
  if (/malformed|truncated|root must/.test(message)) return 'malformed_xml';
  if (/fetch failed|econn|enotfound|socket|network/.test(message)) return 'network_error';
  return 'other';
}

function failureLedger(id, rows) {
  const counter = new Map();
  for (const row of rows) {
    for (const item of row.variants[id].discovery?.errors ?? []) {
      const key = `${item.stage}:${errorClass(item.error)}`;
      counter.set(key, (counter.get(key) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...counter].sort(([a], [b]) => a.localeCompare(b)));
}

export function summarizeVariant(id, rows, reviews = new Map()) {
  const proposals = rows.filter(row => row.variants[id]?.proposal).map(row => row.variants[id].proposal);
  const verdicts = proposals.map(item => reviews.get(item.fingerprint)?.verdict).filter(Boolean);
  const verdictCount = value => verdicts.filter(item => item === value).length;
  const correct = verdictCount('correct');
  const costs = rows.map(row => row.variants[id].cost);
  const total = field => costs.reduce((sum, item) => sum + item[field], 0);
  const latencies = costs.map(item => item.latency_ms);
  const requests = costs.map(item => item.requests);
  const bytes = costs.map(item => item.bytes);
  return {
    id,
    audited_misses: rows.length,
    answered: proposals.length,
    answer_rate: rows.length ? proposals.length / rows.length : 0,
    reviewed: verdicts.length,
    correct,
    wrong_brand: verdictCount('wrong_brand'),
    related_brand: verdictCount('related_brand'),
    not_logo: verdictCount('not_logo'),
    ambiguous: verdictCount('ambiguous'),
    strict_precision: verdicts.length === proposals.length && proposals.length ? correct / proposals.length : null,
    correct_gains_per_100: verdicts.length === proposals.length && rows.length ? 100 * correct / rows.length : null,
    icon_movements: rows.filter(row => row.variants[id].role_movement.icon).length,
    populated_wide_displacements: rows.filter(row => row.variants[id].role_movement.wide).length,
    favicon_movements: rows.filter(row => row.variants[id].role_movement.favicon).length,
    failure_ledger: failureLedger(id, rows),
    cost: {
      requests: total('requests'),
      bytes: total('bytes'),
      mean_latency_ms: rows.length ? Math.round(total('latency_ms') / rows.length) : null,
      p50_latency_ms: percentile(latencies, 0.5),
      p95_latency_ms: percentile(latencies, 0.95),
      max_requests_per_domain: Math.max(0, ...requests),
      max_bytes_per_domain: Math.max(0, ...bytes),
      max_latency_ms_per_domain: Math.max(0, ...latencies),
    },
  };
}

async function validateCandidates(items, homepage, fetchResource, validatePublicUrl = assertPublicUrl) {
  const byUrl = new Map();
  for (const item of items) if (!byUrl.has(item.url)) byUrl.set(item.url, item);
  const rows = await mapConcurrent([...byUrl.values()], 2, async item => {
    const startedAt = performance.now();
    if (item.rawBytes) return {
      url: item.url,
      item: await extractorInternals.validateCandidateBytes(item, item.rawBytes),
      cost: { requests: 0, bytes: 0, latency_ms: Math.round(performance.now() - startedAt) },
    };
    try {
      const response = await fetchResource(item.url, {
        timeoutMs: 4_000,
        maxRedirects: sameRegistrableDomain(item.url, homepage) ? 3 : 0,
        maxBytes: 3 * 1024 * 1024,
        accept: 'image/*,*/*;q=0.6',
        validateUrl: async value => {
          const url = await validatePublicUrl(value);
          const reference = item.evidence?.sitemap_asset_host_policy === 'official-page' ? item.url : homepage;
          if (!sameRegistrableDomain(url.href, reference)) throw new Error('Asset redirect left its admitted registrable domain.');
          return url;
        },
      });
      const checked = response.ok ? await extractorInternals.validateCandidateBytes(item, response.bytes, {
        resolvedUrl: response.url,
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
      }) : null;
      return {
        url: item.url,
        item: checked,
        cost: { requests: response.requestCount, bytes: response.downloadedBytes, latency_ms: response.durationMs },
      };
    } catch (error) {
      return {
        url: item.url,
        item: null,
        error: error.message,
        cost: {
          requests: error.resourceMetrics?.requestCount ?? 0,
          bytes: error.resourceMetrics?.downloadedBytes ?? 0,
          latency_ms: error.resourceMetrics?.durationMs ?? Math.round(performance.now() - startedAt),
        },
      };
    }
  });
  return new Map(rows.map(row => [row.url, row]));
}

function assetMimeType(item) {
  if (item.mimeType) return item.mimeType;
  if (item.format === 'svg') return 'image/svg+xml';
  if (item.format === 'jpg' || item.format === 'jpeg') return 'image/jpeg';
  return item.format ? `image/${item.format}` : 'application/octet-stream';
}

async function hydrateControlAssets(items, controlAssetsRoots) {
  const roots = (Array.isArray(controlAssetsRoots) ? controlAssetsRoots : [controlAssetsRoots]).map(value => resolve(value));
  let hydrated = 0;
  for (const item of items) {
    if (!item.asset_path) throw new Error(`Frozen candidate is missing asset_path: ${item.url}`);
    let bytes = null;
    for (const root of roots) {
      const path = resolve(root, item.asset_path);
      const local = relative(root, path);
      if (!local || local.startsWith('..') || resolve(root, local) !== path) throw new Error(`Unsafe frozen asset path: ${item.asset_path}`);
      try {
        bytes = await readFile(path);
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (!bytes) throw new Error(`Frozen candidate asset is absent from every configured root: ${item.asset_path}`);
    const expectedHash = item.observed?.byte_hash ?? item.content_hash;
    if (!expectedHash) throw new Error(`Frozen candidate is missing a content hash: ${item.asset_path}`);
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== expectedHash) throw new Error(`Frozen asset hash mismatch: ${item.asset_path}`);
    item.dataUrl = `data:${assetMimeType(item)};base64,${bytes.toString('base64')}`;
    hydrated += 1;
  }
  return hydrated;
}

async function runDomain(record, variants, assetsDirectory, controlAssetRoots, captureStore, replayOnly) {
  const fetchResource = cachingResourceFetcher(record.entity_id, captureStore, replayOnly);
  const validatePublicUrl = replayOnly ? async value => new URL(value) : assertPublicUrl;
  const discoveries = new Map();
  // Warm the broadest profile first so all narrower profiles replay identical response bytes.
  const ordered = [...variants].sort((a, b) =>
    (b.options.limits.maxPages - a.options.limits.maxPages) ||
    (b.options.limits.maxSitemapDocuments - a.options.limits.maxSitemapDocuments) ||
    (a.options.minPageScore - b.options.minPageScore));
  for (const variant of ordered) {
    discoveries.set(variant.id, await discoverSitemapBrandAssets({
      homepage: record.homepage,
      companyName: record.name,
      fetchResource,
      validateUrl: async value => {
        const url = await validatePublicUrl(value);
        if (!sameRegistrableDomain(url.href, record.homepage)) throw new Error('Discovery redirect left the official registrable domain.');
        return url;
      },
    }, variant.options));
  }
  const validations = new Map();
  for (const variant of ordered) {
    const validation = await validateCandidates(discoveries.get(variant.id).candidates, record.homepage, fetchResource, validatePublicUrl);
    const validated = [...validation.values()].map(row => row.item).filter(Boolean);
    await extractorInternals.attachContentBoxes(validated, true, record.name, { boxes: 0, bimiSafetyBoxes: 0 });
    await extractorInternals.attachTinySuitability(validated);
    validations.set(variant.id, validation);
  }
  const baseCandidates = structuredClone(record.candidates ?? []);
  await hydrateControlAssets(baseCandidates, controlAssetRoots);
  await extractorInternals.attachContentBoxes(baseCandidates, true, record.name, { boxes: 0, bimiSafetyBoxes: 0 });
  await extractorInternals.attachTinySuitability(baseCandidates);
  const preferences = normalizeAssetPreferences(record.preferences);
  const control = rankCandidates(baseCandidates, { companyName: record.name, preferences });
  const variantsOutput = {};
  for (const variant of variants) {
    const discovery = discoveries.get(variant.id);
    const validation = validations.get(variant.id);
    const nominatedRows = discovery.candidates.map(item => validation.get(item.url)).filter(Boolean);
    const candidateRows = nominatedRows.filter(row => row.item);
    const existingHashes = new Set(baseCandidates.map(item => selectionKey(item)).filter(Boolean));
    const additions = candidateRows.map(row => row.item).filter(item => !existingHashes.has(selectionKey(item)));
    const treatment = rankCandidates([...structuredClone(baseCandidates), ...additions], { companyName: record.name, preferences });
    const roleMovement = Object.fromEntries(['icon', 'wide', 'favicon'].map(role => [role,
      Boolean(control.selectedByRole[role]) && selectedRoleId(control, role) !== selectedRoleId(treatment, role)]));
    const selected = treatment.selectedByRole.wide?.evidence?.sitemap_official_page ? treatment.selectedByRole.wide : null;
    let proposal = null;
    if (selected && !roleMovement.icon && !roleMovement.favicon && !control.selectedByRole.wide) {
      const contentHash = selectionKey(selected);
      if (!/^[0-9a-f]{64}$/.test(contentHash ?? '')) throw new Error('Proposal is missing a validated SHA-256 content hash.');
      const extension = selected.format === 'svg' ? 'svg' : extname(new URL(selected.resolved_url).pathname).slice(1) || selected.format || 'bin';
      const assetPath = `assets/${contentHash}.${extension}`;
      if (selected.dataUrl) await writeFile(join(dirname(assetsDirectory), assetPath), Buffer.from(selected.dataUrl.split(',')[1], 'base64')).catch(error => {
        if (error.code !== 'EEXIST') throw error;
      });
      proposal = {
        entity_id: record.entity_id,
        name: record.name,
        website: record.website,
        variant: variant.id,
        selected_url: selected.resolved_url,
        source_page: selected.source_page,
        width: selected.width,
        height: selected.height,
        source: selected.source,
        content_hash: contentHash,
        asset_path: assetPath,
      };
      proposal.fingerprint = proposalFingerprint(proposal);
    }
    const validationCost = nominatedRows.reduce((sum, row) => ({
      requests: sum.requests + row.cost.requests,
      bytes: sum.bytes + row.cost.bytes,
      latency_ms: sum.latency_ms + row.cost.latency_ms,
    }), { requests: 0, bytes: 0, latency_ms: 0 });
    variantsOutput[variant.id] = {
      discovery: discovery.diagnostics,
      validated: candidateRows.length,
      novel_validated: additions.length,
      validated_candidates: nominatedRows.map(row => {
        if (!row.item) return { url: row.url, error: row.error ?? 'invalid_asset' };
        const scored = treatment.candidates.find(item => selectionKey(item) === selectionKey(row.item)) ?? row.item;
        return {
          url: row.item.resolved_url,
          content_hash: selectionKey(row.item),
          source: row.item.source,
          width: row.item.width,
          height: row.item.height,
          predicted_roles: scored.predicted_roles,
          wide_score: scored.role_scores?.wide,
        };
      }),
      proposal,
      role_movement: roleMovement,
      cost: {
        requests: discovery.diagnostics.requests + validationCost.requests,
        bytes: discovery.diagnostics.bytesDownloaded + validationCost.bytes,
        latency_ms: discovery.diagnostics.networkDurationMs + validationCost.latency_ms,
      },
    };
  }
  return {
    entity_id: record.entity_id,
    name: record.name,
    website: record.website,
    homepage: record.homepage,
    frozen_selected: record.selected_by_role,
    rerank_selected: Object.fromEntries(['icon', 'wide', 'favicon'].map(role => [role, selectedRoleId(control, role)])),
    variants: variantsOutput,
  };
}

function validateReviews(records, reviews) {
  const proposals = new Map(records.flatMap(row => Object.values(row.variants).map(item => item.proposal).filter(Boolean)).map(item => [item.fingerprint, item]));
  const output = new Map();
  for (const review of reviews) {
    if (!proposals.has(review.fingerprint)) throw new Error(`Review does not match a proposal: ${review.fingerprint}`);
    if (!REVIEW_VALUES.has(review.verdict)) throw new Error(`Invalid review verdict: ${review.verdict}`);
    if (output.has(review.fingerprint)) throw new Error(`Duplicate review: ${review.fingerprint}`);
    output.set(review.fingerprint, review);
  }
  return output;
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) return void console.log(help());
  const controlPath = resolve(options.control);
  const controlAssetRoots = options.controlAssets.map(value => resolve(value));
  const output = resolve(options.output);
  const assignmentPath = COHORTS[options.cohort][options.split];
  const selectedVariants = options.variant ? VARIANTS.filter(item => item.id === options.variant) : VARIANTS;
  const assets = join(output, 'assets');
  if (options.capture && options.replay) throw new Error('--capture and --replay are mutually exclusive.');
  await mkdir(assets, { recursive: true });
  const [allControlRows, assignments] = await Promise.all([readJsonl(controlPath), readJsonl(assignmentPath)]);
  const assignmentIds = new Set(assignments.map(item => item.entity_id));
  if (assignmentIds.size !== assignments.length) throw new Error(`Frozen ${options.cohort} ${options.split} assignment contains duplicate entities.`);
  const controlById = new Map(allControlRows.map(item => [item.entity_id, item]));
  if (controlById.size !== allControlRows.length) throw new Error('Frozen control contains duplicate entities.');
  const controlRows = assignments.map(item => controlById.get(item.entity_id));
  if (controlRows.some(item => !item)) throw new Error(`Control does not cover the exact ${options.cohort} ${options.split} assignment.`);
  let eligible = controlRows.filter(record => record.status === 'success' && !record.selected_by_role?.wide);
  if (options.limit) eligible = eligible.slice(0, options.limit);
  const loadedCapture = options.replay ? await readCapture(resolve(options.replay)) : { store: new Map(), sha256: null };
  const captureStore = loadedCapture.store;
  const records = await mapConcurrent(eligible, options.concurrency, record =>
    runDomain(record, selectedVariants, assets, controlAssetRoots, captureStore, Boolean(options.replay)));
  let captureSha256 = loadedCapture.sha256;
  if (options.capture) {
    const captureBytes = encodeCapture(captureStore);
    await mkdir(dirname(resolve(options.capture)), { recursive: true });
    await writeFile(resolve(options.capture), captureBytes);
    captureSha256 = createHash('sha256').update(captureBytes).digest('hex');
  }
  const reviews = options.reviews ? validateReviews(records, await readJsonl(resolve(options.reviews))) : new Map();
  const proposals = [...new Map(records.flatMap(row => Object.values(row.variants).map(item => item.proposal).filter(Boolean)).map(item => [item.fingerprint, item])).values()];
  const summary = {
    schema_version: 3,
    cohort: `${options.cohort}-${options.split}-missing-wide`,
    frozen_control: controlPath,
    frozen_control_sha256: await sha256File(controlPath),
    frozen_control_assets_root: controlAssetRoots.length === 1 ? controlAssetRoots[0] : null,
    frozen_control_asset_roots: controlAssetRoots,
    split: options.split,
    split_sha256: await sha256File(assignmentPath),
    evaluation_opened: false,
    network_mode: options.replay ? 'replay' : options.capture ? 'live_capture' : 'live_ephemeral',
    web_capture_sha256: captureSha256,
    web_capture_entries: captureStore.size,
    eligible_misses: eligible.length,
    variants: Object.fromEntries(selectedVariants.map(variant => [variant.id, {
      description: variant.description,
      options: variant.options,
      ...summarizeVariant(variant.id, records, reviews),
    }])),
    sitemap_prevalence: {
      robots_declared_domains: records.filter(row => Object.values(row.variants).some(item => item.discovery.robots.declared > 0)).length,
      parsed_sitemap_domains: records.filter(row => Object.values(row.variants).some(item => item.discovery.sitemapDocumentsParsed > 0)).length,
      eligible_brand_page_domains: records.filter(row => Object.values(row.variants).some(item => item.discovery.urlsEligible > 0)).length,
      candidate_domains: records.filter(row => Object.values(row.variants).some(item => item.discovery.candidatesDiscovered > 0)).length,
    },
    frozen_rerank_drift: Object.fromEntries(['icon', 'wide', 'favicon'].map(role => [role,
      records.filter(row => Boolean(row.frozen_selected?.[role]) && row.frozen_selected[role] !== row.rerank_selected[role]).length])),
    proposals: proposals.length,
    reviews_applied: reviews.size,
    measurement_note: 'Frozen homepage candidates and sitemap additions are both hydrated from hash-verified asset bytes and receive identical content-box, tiny-suitability, preference-aware ranking. Sitemap/page bytes and failures are shared across variants from one live response cache; per-variant request, byte, and network-latency totals replay recorded resource costs, including failed reads and candidate validations. Failure ledgers expose live-web drift. Promotion decisions require a captured replay; no live homepage delta is attributed to the treatment.',
  };
  await writeFile(join(output, 'results.jsonl'), `${records.map(JSON.stringify).join('\n')}\n`);
  await writeFile(join(output, 'proposals.jsonl'), `${proposals.map(JSON.stringify).join('\n')}${proposals.length ? '\n' : ''}`);
  await writeFile(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const cards = proposals.map(item => `<article><h2>${item.name}</h2><p>${item.variant} · ${item.width}×${item.height}<br>${item.source_page}<br>${item.selected_url}<br><code>${item.fingerprint}</code></p><div><img src="${item.asset_path}"></div><div class="dark"><img src="${item.asset_path}"></div></article>`).join('\n');
  await writeFile(join(output, 'review.html'), `<!doctype html><meta charset="utf-8"><title>Sitemap-wide review</title><style>body{font:14px system-ui;margin:24px}article{margin:0 0 36px}article div{height:180px;display:grid;place-items:center;background:#fff}.dark{background:#111}img{max-width:80%;max-height:130px}code{font-size:10px}</style>${cards}`);
  console.log(JSON.stringify(summary, null, 2));
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) main(process.argv.slice(2)).catch(error => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});

export const internals = { assetMimeType, errorClass, failureLedger, hydrateControlAssets, parseArgs, percentile, proposalFingerprint, validateReviews };
