#!/usr/bin/env node
// Capture/replay a paired Wikimedia resolver experiment. Outputs are research artifacts.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const option = key => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
const output = option('--output');
const capture = option('--responses');
if (!output || !capture) throw new Error('Usage: wikimedia-recall.mjs --output report.json --responses responses.json [--offline] [--domains comma,list] [--revision HEAD] [--timeout-ms 5000]');
const timeoutMs = Number(option('--timeout-ms') ?? 10_000);
if (!Number.isFinite(timeoutMs) || timeoutMs < 250 || timeoutMs > 10_000) throw new Error('timeout-ms must be 250–10000.');
const moduleUrl = new URL('../../src/wikimedia-fallback.mjs', import.meta.url);
const revision = option('--revision');
const source = revision ? execFileSync('git', ['show', `${revision}:src/wikimedia-fallback.mjs`], { encoding: 'utf8' }) : await readFile(moduleUrl, 'utf8');
const importable = source.replace(/from '([^']+)'/g, (_, specifier) => `from '${specifier.startsWith('.') ? new URL(specifier, moduleUrl).href : import.meta.resolve(specifier)}'`);
const { discoverWikimediaLogoCandidates } = await import(`data:text/javascript;base64,${Buffer.from(importable).toString('base64')}`);
const read = path => readFile(resolve(path), 'utf8').then(JSON.parse);
const responses = await read(capture).catch(error => { if (error.code === 'ENOENT') return {}; throw error; });
const roster = await read('brand-library/v2/sources.json');
const trial = await read('brand-library/v2/deep-search/google-images-first-20.json');
const domains = option('--domains')?.split(',');
const brands = domains ? domains.map(domain => roster.brands.find(b => b.domain === domain) ?? { id: domain, name: domain, domain })
  : trial.tested.map(row => roster.brands.find(b => b.id === row.brandId));
const now = new Date('2026-09-18T12:00:00Z');
let liveRequests = 0;
const fetchImpl = async (url, init) => {
  const key = String(url);
  if (!responses[key]) {
    if (args.includes('--offline')) throw new Error(`Uncaptured request: ${key}`);
    const response = await fetch(url, init);
    const body = await response.text();
    if (Buffer.byteLength(body) > 4 * 1024 * 1024) throw new Error('Experiment API body exceeds limit.');
    responses[key] = { status: response.status, headers: Object.fromEntries(response.headers), body };
    liveRequests++;
  }
  const saved = responses[key];
  return new Response(saved.body, { status: saved.status, headers: saved.headers });
};
const rows = [];
for (const brand of brands) {
  const network = { requests: 0, bytesDownloaded: 0 };
  const started = performance.now();
  const result = await discoverWikimediaLogoCandidates({ domain: brand.domain, missingRoles: ['icon', 'wide'] }, {
    fetchImpl, cache: new Map(), now: () => now, diagnostics: network, timeoutMs,
  });
  const row = { id: brand.id, domain: brand.domain, name: brand.name, durationMs: Math.round(performance.now() - started), network, ...result };
  rows.push(row);
  console.log(JSON.stringify({ id: row.id, status: result.diagnostics.status, durationMs: row.durationMs, files: result.candidates.map(c => c.evidence.commons_filename) }));
  await mkdir(dirname(resolve(capture)), { recursive: true });
  await writeFile(resolve(capture), JSON.stringify(responses, null, 2) + '\n');
}
const report = { sourceSha256: createHash('sha256').update(source).digest('hex'), now: now.toISOString(),
  offline: args.includes('--offline'), timeoutMs, liveRequests, total: rows.length,
  resolved: rows.filter(row => row.candidates.length).length, rows };
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ total: report.total, resolved: report.resolved, liveRequests }));
