import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { internals, summarizeVariant, VARIANTS } from '../scripts/experiments/sitemap-wide-experiment.mjs';

test('sitemap experiment declares the intended bounded variant matrix', () => {
  assert.deepEqual(VARIANTS.map(item => item.id), [
    'robots_strict_1',
    'conventional_strict_1',
    'union_strict_1',
    'union_balanced_1',
    'union_balanced_2',
    'union_fresh_2',
    'robots_strict_exact_cdn_1',
    'robots_strict_exact_cdn_2',
    'robots_corporate_exact_cdn_1',
    'robots_corporate_exact_cdn_2',
    'union_strict_exact_cdn_1',
  ]);
  for (const variant of VARIANTS) {
    assert.ok(variant.options.limits.maxSitemapDocuments <= 4);
    assert.ok(variant.options.limits.maxPages <= 2);
    assert.ok(variant.options.limits.maxCandidates <= 4);
    assert.ok((variant.options.limits.maxRequests ?? 16) <= 16);
    assert.ok((variant.options.limits.maxTotalBytes ?? 8 * 1024 * 1024) <= 8 * 1024 * 1024);
  }
});

test('control candidates are hydrated from hash-verified frozen asset bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logo-yoink-sitemap-control-'));
  try {
    const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>');
    const hash = createHash('sha256').update(bytes).digest('hex');
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets', `${hash}.svg`), bytes);
    const items = [{
      url: 'https://acme.test/logo.svg',
      asset_path: `assets/${hash}.svg`,
      content_hash: hash,
      format: 'svg',
    }];
    assert.equal(await internals.hydrateControlAssets(items, root), 1);
    assert.match(items[0].dataUrl, /^data:image\/svg\+xml;base64,/);
    await assert.rejects(() => internals.hydrateControlAssets([{ ...items[0], asset_path: '../escape.svg' }], root), /Unsafe frozen asset path/);
    await assert.rejects(() => internals.hydrateControlAssets([{ ...items[0], content_hash: undefined }], root), /missing a content hash/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('control hydration supports a hash-verified union of asset roots', async () => {
  const first = await mkdtemp(join(tmpdir(), 'logo-yoink-sitemap-empty-'));
  const second = await mkdtemp(join(tmpdir(), 'logo-yoink-sitemap-assets-'));
  try {
    const bytes = Buffer.from('asset bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    await mkdir(join(second, 'assets'));
    await writeFile(join(second, 'assets', `${hash}.png`), bytes);
    const items = [{ url: 'https://acme.test/logo.png', asset_path: `assets/${hash}.png`, content_hash: hash, format: 'png' }];
    assert.equal(await internals.hydrateControlAssets(items, [first, second]), 1);
    await assert.rejects(
      () => internals.hydrateControlAssets(items, [first]),
      /absent from every configured root/,
    );
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});

test('variant summaries count strict verdicts, role movement, latency, and worst-domain resources', () => {
  const id = 'union_balanced_1';
  const rows = [
    { variants: { [id]: { proposal: { fingerprint: 'a' }, role_movement: { icon: false, wide: false, favicon: false }, cost: { requests: 4, bytes: 100, latency_ms: 20 } } } },
    { variants: { [id]: { proposal: { fingerprint: 'b' }, role_movement: { icon: true, wide: false, favicon: false }, cost: { requests: 7, bytes: 300, latency_ms: 50 } } } },
    { variants: { [id]: { proposal: null, role_movement: { icon: false, wide: false, favicon: true }, cost: { requests: 1, bytes: 25, latency_ms: 10 } } } },
  ];
  const reviews = new Map([['a', { verdict: 'correct' }], ['b', { verdict: 'wrong_brand' }]]);
  const summary = summarizeVariant(id, rows, reviews);
  assert.equal(summary.strict_precision, 0.5);
  assert.equal(summary.correct_gains_per_100, 100 / 3);
  assert.equal(summary.icon_movements, 1);
  assert.equal(summary.favicon_movements, 1);
  assert.equal(summary.populated_wide_displacements, 0);
  assert.deepEqual(summary.cost, {
    requests: 12,
    bytes: 425,
    mean_latency_ms: 27,
    p50_latency_ms: 20,
    p95_latency_ms: 50,
    max_requests_per_domain: 7,
    max_bytes_per_domain: 300,
    max_latency_ms_per_domain: 50,
  });
});

test('argument parsing exposes frozen development cohorts but never evaluation', () => {
  assert.equal(internals.parseArgs([]).cohort, 'major-brands-300');
  const original = internals.parseArgs(['--cohort', 'original-500', '--control-assets', '/one', '--control-assets', '/two']);
  assert.equal(original.cohort, 'original-500');
  assert.deepEqual(original.controlAssets, ['/one', '/two']);
  assert.throws(() => internals.parseArgs(['--cohort', 'unknown']), /--cohort must be one of/);
  assert.throws(() => internals.parseArgs(['--cohort', 'original-500', '--split', 'evaluation']), /evaluation is intentionally unsupported/);
});
