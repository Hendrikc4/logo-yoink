#!/usr/bin/env node
// Offline repeat-workload ablation of the production 32MiB/256-entry cache.
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const base = 'runs/missing-logo-program-2026-09-19/discovery';
const sourceUrl = new URL('../../src/wikimedia-fallback.mjs', import.meta.url);
const captures = {};
const domains = new Set();
const inventory = JSON.parse(await readFile('reports/missing-logo-program-2026-09-19/inventory.json'));
const allowed = new Set(inventory.rows.filter(r => r.split === 'development').map(r => r.domain));
for (const prefix of ['', 'validation-']) {
  Object.assign(captures, JSON.parse(await readFile(`runs/wikimedia-recall-2026-09-18/${prefix}responses.json`)));
  for (const row of JSON.parse(await readFile(`runs/wikimedia-recall-2026-09-18/${prefix || 'development-'}final-replay.json`)).rows) if (allowed.has(row.domain)) domains.add(row.domain);
}
const sources = { baseline: await readFile(`${base}/baseline-wikimedia-fallback.mjs`, 'utf8'), treatment: await readFile(sourceUrl, 'utf8') };
const rows = [], hashes = {};
for (const [variant, source] of Object.entries(sources)) {
  hashes[variant] = createHash('sha256').update(source).digest('hex');
  // Keep the exact production cache implementation; only enable it for our fixture transport.
  const instrumented = source.replace(/const isolatedRuntime = Boolean\([^;]+\);/, 'const isolatedRuntime = false;')
    .replace(/from '([^']+)'/g, (_, s) => `from '${s.startsWith('.') ? new URL(s, sourceUrl).href : import.meta.resolve(s)}'`)
    + '\nexport const experimentCacheState = () => ({entries: DEFAULT_CACHE.size, accountedBytes: defaultCacheBytes});';
  const resolver = await import(`data:text/javascript;base64,${Buffer.from(instrumented).toString('base64')}`);
  for (const phase of ['first-pass', 'repeat-pass']) for (const domain of domains) {
    const network = { requests: 0, bytesDownloaded: 0 };
    const start = performance.now();
    const result = await resolver.discoverWikimediaLogoCandidates({ domain, missingRoles: ['icon', 'wide'] }, {
      now: () => new Date('2026-09-18T12:00:00Z'), validateUrl: async url => new URL(url), diagnostics: network, timeoutMs: 10000,
      fetchImpl: async url => {
        const saved = captures[String(url)];
        if (!saved) throw new Error(`Uncaptured request: ${url}`);
        return new Response(saved.body, { status: saved.status, headers: saved.headers });
      },
    });
    rows.push({ variant, phase, domain, network, durationMs: performance.now() - start, cache: resolver.experimentCacheState(), ...result });
  }
}
const summary = {};
for (const variant of Object.keys(sources)) for (const phase of ['first-pass', 'repeat-pass']) {
  const group = rows.filter(r => r.variant === variant && r.phase === phase);
  summary[`${variant}/${phase}`] = {
    domains: group.length, resolved: group.filter(r => r.candidates.length).length,
    requests: group.reduce((s, r) => s + r.network.requests, 0), bytes: group.reduce((s, r) => s + r.network.bytesDownloaded, 0),
    totalCpuReplayMs: Math.round(group.reduce((s, r) => s + r.durationMs, 0)), finalCache: group.at(-1).cache,
  };
}
const changes = [...domains].filter(domain => {
  const a = rows.find(r => r.variant === 'baseline' && r.phase === 'first-pass' && r.domain === domain);
  const b = rows.find(r => r.variant === 'treatment' && r.phase === 'repeat-pass' && r.domain === domain);
  return a.diagnostics.status !== b.diagnostics.status || JSON.stringify(a.candidates) !== JSON.stringify(b.candidates);
});
const report = { offline: true, productionCacheEnabledForFixtureTransport: true, sourceHashes: hashes, domains: [...domains], summary, changes, rows };
await mkdir(base, { recursive: true });
await writeFile(`${base}/cache-capacity.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary, changes }, null, 2));
if (changes.length) process.exitCode = 1;
