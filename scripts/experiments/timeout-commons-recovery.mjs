#!/usr/bin/env node
// Hybrid check: live homepage acquisition plus captured, identity-verified Commons
// discovery and previously downloaded asset bytes. This is NOT a cold API benchmark.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { extractLogos } from '../../src/extractor.mjs';
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const id = option('--id', '3m');
const input = resolve(option('--input', 'runs/missing-logo-program-2026-09-19/roles/audit.json'));
const output = resolve(option('--output', `runs/missing-logo-program-2026-09-19/roles/timeout-${id}.json`));
const payload = JSON.parse(await readFile(input, 'utf8'));
const row = Array.isArray(payload) ? payload.find(row => row.id === id && row.validated) : payload;
if (!row || row.id !== id) throw new Error(`No captured candidate for ${id}`);
const candidate = row.candidate ?? row.candidates?.[0];
const capturePath = option('--capture', null);
const capture = capturePath ? JSON.parse(await readFile(resolve(capturePath), 'utf8')) : null;
if (capture && (capture.url !== candidate.url || capture.status !== 200)) throw new Error('Capture does not match candidate');
const bytes = Buffer.from(capture?.body ?? candidate.dataUrl.split(',')[1], 'base64');
const syntheticTimeout = args.includes('--synthetic-timeout');
const { dataUrl, observed, tinySuitability, tinySuitabilityChecked, role_scores, predicted_roles, ...discovered } = candidate;
let homepageRequests = 0, resolverCalls = 0, assetReplays = 0;
const fetchImpl = async (...args) => { homepageRequests++; if (syntheticTimeout) throw new DOMException('Synthetic homepage timeout', 'AbortError'); return fetch(...args); };
const wikimediaResolver = async () => { resolverCalls++; return { candidates: [discovered], diagnostics: { status: 'captured_identity_replay' } }; };
const wikimediaFetch = async url => {
  if (url !== candidate.url) throw new Error('Unexpected uncaptured Commons asset');
  assetReplays++;
  const response = new Response(bytes, { headers: { 'content-type': candidate.mimeType ?? 'image/svg+xml' } });
  Object.defineProperty(response, 'url', { value: candidate.resolvedUrl ?? candidate.url });
  return response;
};
const started = performance.now();
let result;
try {
  const extracted = await extractLogos(row.domain, { companyName: row.name, jinaApiKey: '', timeoutMs: 4000,
    fetchImpl, wikimediaResolver, wikimediaFetch, preferences: { icon: { theme: 'light' }, logo: { theme: 'light' } } });
  result = { success: true, assets: Object.fromEntries(Object.entries(extracted.assets).map(([key, value]) => [key, value ? { url: value.url, source: value.source, hash: value.observed?.byte_hash } : null])), diagnostics: extracted.diagnostics };
} catch (error) { result = { success: false, error: error.message, diagnostics: error.diagnostics }; }
const report = { id, input, capturePath, homepageMode: syntheticTimeout ? 'synthetic-timeout' : 'live', method: `${syntheticTimeout ? 'Synthetic timed-out homepage' : 'Live homepage'}; captured discovery and asset bytes; real URL/DNS safety checks. Old timeout gate necessarily throws for the same all-timeout reachability. Not a cold Wikimedia API measurement.`, homepageRequests, resolverCalls, assetReplays, durationMs: Math.round(performance.now() - started), ...result };
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
