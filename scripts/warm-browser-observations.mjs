#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { discoverBrowserLogos } from '../src/discover-browser.mjs';
import { internals } from '../src/extractor.mjs';

const DISCOVERY_VERSION = 'missing-wide-browser-v1';
const THEMES = ['light', 'dark'];
const VIEWPORT = { width: 1440, height: 900 };
const REACHABLE = new Set(['live_html', 'redirected_off_domain']);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function observationKey({ url, company, browserVersion }) {
  return createHash('sha256').update(canonicalJson({
    version: DISCOVERY_VERSION, url, company: String(company ?? ''), browser_version: browserVersion,
    themes: THEMES, viewport: VIEWPORT,
  })).digest('hex');
}

export function missingWideQueue(results) {
  return results.filter(result => result.status === 'success' && REACHABLE.has(result.reachability) && !result.selected_by_role?.wide);
}

export async function observationCacheState(path, maxAgeMs = Infinity, nowMs = Date.now()) {
  if (!existsSync(path)) return 'miss';
  if (maxAgeMs === Infinity) return 'fresh';
  const ageMs = Math.max(0, nowMs - (await stat(path)).mtimeMs);
  return ageMs < maxAgeMs ? 'fresh' : 'stale';
}

async function jsonl(path) {
  return (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

async function atomicWrite(path, content) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, path);
}

async function mapConcurrent(items, concurrency, mapper, onResult = () => {}) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index]);
      await onResult(output[index]);
    }
  }));
  return output;
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
}

async function main() {
  const [runArg, outputArg, concurrencyArg = '2', timeoutArg = '12000', maxAgeArg = 'Infinity'] = process.argv.slice(2);
  if (!runArg || !outputArg) {
    throw new Error('Usage: node scripts/warm-browser-observations.mjs <static-run> <observations> [concurrency<=2] [timeout-ms] [max-age-ms]');
  }
  const concurrency = Math.min(2, Number(concurrencyArg));
  const timeoutMs = Number(timeoutArg);
  const maxAgeMs = maxAgeArg === 'Infinity' ? Infinity : Number(maxAgeArg);
  if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(timeoutMs) || timeoutMs < 1 ||
      (maxAgeMs !== Infinity && (!Number.isInteger(maxAgeMs) || maxAgeMs < 0))) {
    throw new Error('Invalid concurrency, timeout, or max age.');
  }
  const runDirectory = resolve(runArg);
  const outputDirectory = resolve(outputArg);
  await mkdir(outputDirectory, { recursive: true });
  const queue = missingWideQueue(await jsonl(join(runDirectory, 'results.jsonl')));
  const playwright = await import('playwright');
  const browser = await playwright.chromium.launch({ headless: true });
  const browserVersion = browser.version();
  const validation = { requests: 0, bytesDownloaded: 0 };
  const started = performance.now();
  let completed = 0;
  let outcomes;
  try {
    outcomes = await mapConcurrent(queue, concurrency, async record => {
      const key = observationKey({ url: record.homepage, company: record.name, browserVersion });
      const path = join(outputDirectory, `${key}.json`);
      const cacheState = await observationCacheState(path, maxAgeMs);
      if (cacheState === 'fresh') return { entity_id: record.entity_id, key, cache: 'hit' };
      const rendered = await discoverBrowserLogos(
        { url: record.homepage, domain: record.domain, company: record.name },
        { browser, darkMode: true, timeoutMs },
      );
      const converted = rendered.candidates
        .map(item => internals.fromBrowserCandidate(item, record.homepage, ['wide']))
        .filter(Boolean)
        .sort((a, b) => internals.discoveryPriority(b) - internals.discoveryPriority(a))
        .slice(0, 8);
      const validated = await mapConcurrent(converted, 4, item => internals.validateCandidate(item, timeoutMs, validation));
      const artifact = {
        schema_version: 1, discovery_version: DISCOVERY_VERSION, observation_key: key,
        entity_id: record.entity_id, domain: record.domain, homepage_url: record.homepage,
        inputs: { url: record.homepage, company: record.name, browser_version: browserVersion, themes: THEMES, viewport: VIEWPORT, eligible_roles: ['wide'] },
        diagnostics: rendered.diagnostics,
        candidates: converted.map((item, index) => ({ source: item.source, validated: validated[index] ?? null })),
      };
      await atomicWrite(path, `${JSON.stringify(artifact)}\n`);
      return {
        entity_id: record.entity_id, key, cache: 'miss', stale_refresh: cacheState === 'stale', duration_ms: rendered.diagnostics.durationMs,
        requests: rendered.diagnostics.requests, bytes: rendered.diagnostics.declaredTransferBytes,
        validated: validated.filter(Boolean).length,
      };
    }, () => { completed++; process.stderr.write(`\r${completed}/${queue.length}`); });
  } finally {
    await browser.close();
    if (queue.length) process.stderr.write('\n');
  }
  const misses = outcomes.filter(item => item.cache === 'miss');
  const summary = {
    schema_version: 1, discovery_version: DISCOVERY_VERSION, parent_run: runDirectory,
    queue: queue.length, browser_invocations: misses.length, cache_hits: outcomes.length - misses.length,
    cache_max_age_ms: maxAgeMs === Infinity ? null : maxAgeMs,
    stale_refreshes: misses.filter(item => item.stale_refresh).length,
    browser_concurrency_max: concurrency, browser_timeout_ms: timeoutMs,
    totals: {
      wall_ms: Math.round(performance.now() - started),
      browser_requests: misses.reduce((sum, item) => sum + (item.requests ?? 0), 0),
      browser_declared_bytes: misses.reduce((sum, item) => sum + (item.bytes ?? 0), 0),
      validation_requests: validation.requests, validation_downloaded_bytes: validation.bytesDownloaded,
    },
    deferred_latency_ms: { p50: percentile(misses.map(item => item.duration_ms), 0.5), p95: percentile(misses.map(item => item.duration_ms), 0.95) },
    per_domain: outcomes.sort((a, b) => a.entity_id.localeCompare(b.entity_id)),
  };
  await atomicWrite(join(outputDirectory, 'warm-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${outputDirectory}\ninvocations ${summary.browser_invocations}; cache hits ${summary.cache_hits}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch(error => { process.stderr.write(`browser observation warm: ${error.message}\n`); process.exitCode = 1; });
}
