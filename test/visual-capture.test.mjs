import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CAPTURE_VERSION,
  SCHEMA_VERSION,
  captureEntity,
  captureShard,
  normaliseTarget,
  safeEntityPath,
  shardFor,
} from '../src/visual-capture.mjs';
import { validateRecord } from '../scripts/visual-benchmark-validate.mjs';
import { generateShards } from '../scripts/visual-benchmark-shards.mjs';
import { validateRun } from '../scripts/visual-benchmark-validate.mjs';

const SAFE_SVG_DATA_URL = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 24"><path fill="#000" d="M0 0h120v24H0z"/></svg>').toString('base64')}`;

function fakeExtractLogos() {
  return {
    homepage: 'https://example.com/',
    candidates: [{ url: 'https://cdn.example.com/logo.svg', resolvedUrl: 'https://cdn.example.com/logo.svg', source: 'dom-img', format: 'svg', mimeType: 'image/svg+xml', width: 120, height: 24, dataUrl: SAFE_SVG_DATA_URL, evidence: { rendered: true, dom_region: 'header', home_linked: true }, role_scores: { wide: 90 }, score: 90, predicted_roles: ['wide'], score_reasons: ['header placement +18'] }],
    diagnostics: { errors: [] },
  };
}

function fakeBrowser({ rejectClips = false, instanceCount = 1 } = {}) {
  const calls = [];
  const page = {
    on() {},
    async route() {},
    setDefaultTimeout(value) { calls.push(['timeout', value]); },
    setDefaultNavigationTimeout() {},
    async setViewportSize(value) { calls.push(['viewport', value]); },
    async emulateMedia(value) { calls.push(['theme', value.colorScheme]); },
    async goto(url) { calls.push(['goto', url]); },
    async waitForLoadState() {},
    async waitForTimeout() {},
    url() { return 'https://example.com/'; },
    async content() { return '<html><header><img src="https://cdn.example.com/logo.svg" /></header></html>'; },
    async evaluate(fn, argument) {
      if (fn.name === 'inspectPage') return Array.from({ length: instanceCount }, (_, index) => ({ kind: 'img', source: 'browser-img', url: `https://cdn.example.com/${index === 0 ? 'logo' : `logo-${index}`}.svg`, box: { x: 10 + index * 140, y: 12, width: 120, height: 24 }, region: 'header', homeLinked: true, alt: 'Example logo' }));
      if (fn.name === 'addOverlay') return true;
      if (fn.name === 'removeOverlay' || fn.name === 'restorePage' || fn.name === 'scrollToY') return true;
      return { width: 1440, height: 1500 };
    },
    async screenshot(options) {
      if (rejectClips && options.clip) throw new Error('page.screenshot: Clipped area is either empty or outside the resulting image');
      return Buffer.from(`fake-${options.clip?.y ?? 0}-${options.clip?.width ?? 0}`);
    },
    async close() { calls.push(['close']); },
  };
  return { browser: { version: () => 'fake', async newPage() { return page; }, async close() {} }, calls };
}

test('normaliseTarget accepts public HTTP(S) sites and rejects unsafe URLs', () => {
  assert.equal(normaliseTarget({ website: 'example.com', name: 'Example' }).url, 'https://example.com/');
  assert.throws(() => normaliseTarget('file:///tmp/site'), /HTTP\(S\)/);
  assert.throws(() => normaliseTarget('http://127.0.0.1'), /private-network/);
  assert.throws(() => normaliseTarget('http://192.0.0.9'), /private-network/);
  assert.throws(() => normaliseTarget('http://224.0.0.1'), /private-network/);
  assert.throws(() => normaliseTarget('http://[::ffff:127.0.0.1]'), /private-network/);
  assert.throws(() => normaliseTarget('http://[2001:db8::1]'), /private-network/);
  assert.throws(() => normaliseTarget('https://user:pass@example.com'), /credentials/);
});

test('persisted diagnostics redact token values and URL query fragments', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'logo-yoink-redaction-'));
  const { browser } = fakeBrowser();
  const page = await browser.newPage();
  page.goto = async () => { throw new Error('request https://example.com/path?token=do-not-store secret=also-hidden token=plain-secret'); };
  try {
    const result = await captureEntity({ entity_id: 'redact-1', name: 'Redact', website: 'https://example.com' }, { outputRoot, browser: { ...browser, async newPage() { return page; } }, lookup: false, hydrationMs: 0, extractLogos: fakeExtractLogos });
    const text = JSON.stringify(result);
    assert.doesNotMatch(text, /do-not-store|also-hidden|plain-secret/);
    assert.match(text, /token=\[redacted\]/);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test('shard assignment and artifact paths are deterministic and bounded', () => {
  assert.equal(shardFor('company-1', 4), shardFor('company-1', 4));
  assert.ok(shardFor('company-1', 4) >= 0 && shardFor('company-1', 4) < 4);
  assert.match(safeEntityPath('/tmp/visual-run', '../entity'), /captures\/\.\._entity-[a-f0-9]{10}$/);
  assert.notEqual(safeEntityPath('/tmp/visual-run', 'a/b'), safeEntityPath('/tmp/visual-run', 'a_b'));
});

test('captureEntity writes resumable screenshots, overlays, crops, mappings, and page manifest', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'logo-yoink-capture-'));
  const { browser, calls } = fakeBrowser();
  try {
    const result = await captureEntity({ entity_id: 'example-1', name: 'Example', website: 'https://example.com' }, {
      outputRoot, browser, lookup: false, hydrationMs: 0, maxTiles: 2, extractLogos: fakeExtractLogos,
    });
    assert.equal(result.capture_version, CAPTURE_VERSION);
    assert.equal(result.complete, true);
    assert.equal(result.views.length, 3);
    assert.equal(result.views[0].instances[0].home_linked, true);
    assert.equal(result.mapping_rows[0].mapping_confidence, 'exact');
    assert.equal(result.candidate_rows[0].preview_path, null);
    const pagePath = join(outputRoot, 'captures', 'example-1', 'page.json');
    const page = JSON.parse(await readFile(pagePath, 'utf8'));
    assert.equal(page.complete, true);
    assert.match(page.views[0].top.path, /desktop-light-top\.png$/);
    assert.match(page.views[0].overlay.path, /desktop-light-overlay\.png$/);
    assert.match(page.views[0].crops[0].path, /element-crops\/desktop-light-crop-001\.png$/);
    for (const row of [result.capture_row, ...result.candidate_rows, ...result.visual_instance_rows, ...result.mapping_rows, ...result.rejection_rows]) assert.equal(validateRecord(row), true);
    assert.equal(result.capture_row.schema_version, SCHEMA_VERSION);
    const resumed = await captureEntity({ entity_id: 'example-1', name: 'Example', website: 'https://example.com' }, { outputRoot, browser, resume: true, extractLogos: fakeExtractLogos });
    assert.equal(resumed.resumed, true);
    assert.ok(calls.some(([name]) => name === 'goto'));
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test('captureShard consumes fixture companies and writes a shard checkpoint', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'logo-yoink-shard-'));
  const { browser } = fakeBrowser();
  try {
    const fixture = { schema_version: 1, fixture_companies: [{ entity_id: 'a', name: 'A', website: 'https://example.com', cohort: 'pilot' }, { entity_id: 'b', name: 'B', website: 'https://example.com', cohort: 'pilot' }] };
    const result = await captureShard(fixture, { outputRoot, browser, lookup: false, hydrationMs: 0, shardCount: 1, shardIndex: 0, maxTiles: 1, extractLogos: fakeExtractLogos });
    assert.equal(result.assigned, 2);
    assert.equal(result.shard, null);
    assert.match(await readFile(join(outputRoot, 'captures.jsonl'), 'utf8'), /"record_type":"entity_capture"/);
    assert.match(await readFile(join(outputRoot, 'candidates.jsonl'), 'utf8'), /"record_type":"candidate"/);
    assert.match(await readFile(join(outputRoot, 'capture-manifest.json'), 'utf8'), /visual-benchmark-v1/);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test('capture output is consumable by the standard benchmark record validator', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'logo-yoink-contract-'));
  const { browser } = fakeBrowser();
  try {
    const fixturePath = join(outputRoot, 'fixture.json');
    const fixture = { companies: [{ entity_id: 'contract-a', name: 'Contract A', website: 'https://example.com', cohort: 'pilot' }] };
    await writeFile(fixturePath, `${JSON.stringify(fixture)}\n`);
    await generateShards({ inputPath: fixturePath, outputPath: outputRoot, shardCount: 1 });
    await captureShard({ schema_version: 1, fixture_companies: fixture.companies }, { outputRoot, browser, lookup: false, hydrationMs: 0, shardCount: 1, shardIndex: 0, maxTiles: 1, extractLogos: fakeExtractLogos });
    const assignmentManifest = JSON.parse(await readFile(join(outputRoot, 'benchmark-manifest.json'), 'utf8'));
    assert.equal(assignmentManifest.benchmark_version, 1);
    assert.equal(assignmentManifest.schema_version, 'visual-benchmark-v1');
    const captureManifest = JSON.parse(await readFile(join(outputRoot, 'capture-manifest.json'), 'utf8'));
    assert.equal(captureManifest.schema_version, 'visual-benchmark-v1');
    assert.equal(captureManifest.record_type, 'capture_manifest');
    assert.equal(captureManifest.entity_count, 1);
    assert.equal(captureManifest.completed_entity_ids.length, 1);
    assert.match(captureManifest.config_hash, /^[a-f0-9]{64}$/);
    assert.match(captureManifest.assignment_manifest_digest, /^[a-f0-9]{64}$/);
    assert.ok(captureManifest.created_at);
    assert.ok(Object.hasOwn(captureManifest, 'budget_state'));
    const summary = await validateRun(outputRoot, { strict: true });
    assert.equal(summary.total, 1);
    assert.ok(summary.records >= 5);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test('worker mode writes only to an owned output root and canonicalizes persisted URLs', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'logo-yoink-worker-'));
  const { browser } = fakeBrowser();
  try {
    const result = await captureShard({ schema_version: 1, fixture_companies: [{ entity_id: 'worker-a', name: 'Worker A', website: 'https://www.example.com/?token=secret#fragment', cohort: 'pilot' }] }, {
      outputRoot, workerId: 'task/01', browser, lookup: false, hydrationMs: 0, maxTiles: 1,
      extractLogos: () => ({ homepage: 'https://www.example.com/?token=secret', candidates: [{ url: 'https://cdn.example.com/logo.svg?secret=abc#fragment', resolvedUrl: 'https://cdn.example.com/logo.svg?secret=abc#fragment', source: 'dom-img', format: 'svg', width: 120, height: 24, dataUrl: SAFE_SVG_DATA_URL, evidence: { rendered: true, dom_region: 'header', home_linked: true } }], diagnostics: { errors: [] } }),
    });
    assert.match(result.outputRoot, /workers\/task_01-[a-f0-9]{10}$/);
    assert.equal(result.records[0].requested_url, 'https://www.example.com/');
    assert.equal(result.records[0].final_url, 'https://example.com/');
    assert.equal(result.records[0].candidate_rows[0].source_url, 'https://cdn.example.com/logo.svg');
    assert.equal(result.records[0].candidate_rows[0].resolved_url, 'https://cdn.example.com/logo.svg');
    assert.ok(!existsSync(join(outputRoot, 'captures.jsonl')));
    assert.ok(existsSync(join(result.outputRoot, 'captures.jsonl')));
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test('global view and viewport limits truncate safely', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'logo-yoink-bounds-'));
  const { browser } = fakeBrowser();
  try {
    const views = Array.from({ length: 6 }, (_, index) => ({ id: `view-${index}`, theme: 'light', viewport: { width: 10_000, height: 10_000 } }));
    const result = await captureEntity({ entity_id: 'bounded-1', name: 'Bounded', website: 'https://example.com' }, {
      outputRoot, browser, lookup: false, hydrationMs: 0, views, maxInstances: 999, maxCrops: 999, extractLogos: fakeExtractLogos,
    });
    assert.equal(result.views.length, 3);
    assert.ok(result.views.every(view => view.viewport.width * view.viewport.height <= 4_000_000));
    assert.equal(result.capture_row.capture_status, 'incomplete');
    assert.equal(result.capture_row.resource_status, 'truncated');
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test('repeated top and tile observations do not consume the unique instance budget', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'logo-yoink-instance-dedupe-'));
  const { browser } = fakeBrowser();
  try {
    const result = await captureEntity({ entity_id: 'dedupe-1', name: 'Dedupe', website: 'https://example.com' }, {
      outputRoot, browser, lookup: false, hydrationMs: 0, maxTiles: 2, maxInstances: 1,
      views: [{ id: 'desktop-light', theme: 'light', viewport: { width: 1440, height: 1000 } }],
      extractLogos: fakeExtractLogos,
    });
    assert.equal(result.complete, true);
    assert.equal(result.diagnostics.instanceCount, 1);
    assert.equal(result.diagnostics.truncation_reasons.includes('instance-budget'), false);
    assert.equal(result.visual_instance_rows.length, 1);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test('crop-only evidence cap keeps an otherwise exhaustive capture complete', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'logo-yoink-crop-cap-'));
  const { browser } = fakeBrowser({ instanceCount: 3 });
  try {
    const result = await captureEntity({ entity_id: 'crop-cap-1', name: 'Crop Cap', website: 'https://example.com' }, {
      outputRoot, browser, lookup: false, hydrationMs: 0, maxTiles: 1, maxCrops: 1, maxInstances: 10,
      views: [{ id: 'desktop-light', theme: 'light', viewport: { width: 1440, height: 1000 } }],
      extractLogos: fakeExtractLogos,
    });
    assert.equal(result.visual_instance_rows.length, 3);
    assert.equal(result.views[0].crops.length, 1);
    assert.equal(result.diagnostics.cropEvidenceTruncated, true);
    assert.deepEqual(result.diagnostics.cropTruncationReasons, ['crop-budget']);
    assert.equal(result.diagnostics.budgetTruncated, false);
    assert.equal(result.capture_row.capture_status, 'success');
    assert.equal(result.capture_row.resource_status, 'complete');
    assert.equal(result.complete, true);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test('clipped screenshot failures are nonfatal, preserve evidence, and classify capture as incomplete', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'logo-yoink-clipped-'));
  const failing = fakeBrowser({ rejectClips: true });
  try {
    const first = await captureEntity({ entity_id: 'clipped-1', name: 'Clipped', website: 'https://example.com' }, {
      outputRoot, browser: failing.browser, lookup: false, hydrationMs: 0, maxTiles: 1, extractLogos: fakeExtractLogos,
    });
    assert.equal(first.complete, false);
    assert.equal(first.capture_row.capture_status, 'incomplete');
    assert.equal(first.capture_row.reachability, 'live_first_party');
    assert.equal(first.candidate_rows.length, 1);
    assert.equal(first.visual_instance_rows.length, 1);
    assert.ok(first.rejection_rows.some(row => row.stage === 'other' && /clipped area/i.test(row.reason)));

    const recovered = await captureEntity({ entity_id: 'clipped-1', name: 'Clipped', website: 'https://example.com' }, {
      outputRoot, browser: fakeBrowser().browser, lookup: false, hydrationMs: 0, maxTiles: 1, resume: true, extractLogos: fakeExtractLogos,
    });
    assert.equal(recovered.resumed, undefined);
    assert.equal(recovered.complete, true);
    assert.equal(recovered.capture_row.capture_status, 'success');
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test('navigation/artifact failures are not mislabeled as DNS/TLS failures', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'logo-yoink-taxonomy-'));
  const { browser } = fakeBrowser();
  const page = await browser.newPage();
  page.goto = async () => { throw new Error('page.screenshot: Clipped area is either empty or outside the resulting image'); };
  const failingBrowser = { ...browser, async newPage() { return page; } };
  try {
    const result = await captureEntity({ entity_id: 'artifact-failure', name: 'Artifact Failure', website: 'https://example.com' }, {
      outputRoot, browser: failingBrowser, lookup: false, hydrationMs: 0, extractLogos: fakeExtractLogos,
    });
    assert.equal(result.capture_row.reachability, 'incomplete_blank');
    assert.notEqual(result.capture_row.reachability, 'dns_tls_failure');
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
