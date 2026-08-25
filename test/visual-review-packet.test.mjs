import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildReviewPacket, draftStorageKey, labelIdFor, loadBundle, parseArgs, targetKeyFor } from '../scripts/review/visual-review-packet.mjs';
import { RANKER_SAFE_REVIEW_VERSION, normalizeLabelRecord, validateCanonicalLabel } from '../benchmark/lib/labels.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function jsonl(path, records) {
  await writeFile(path, records.map(record => JSON.stringify(record)).join('\n') + '\n');
}

async function syntheticRun() {
  const run = await mkdtemp(join(tmpdir(), 'logo-yoink-visual-packet-'));
  await mkdir(join(run, 'captures', 'acme'), { recursive: true });
  await mkdir(join(run, 'assets'), { recursive: true });
  await mkdir(join(run, 'captures', 'acme', 'overlays'), { recursive: true });
  await mkdir(join(run, 'captures', 'acme', 'element-crops'), { recursive: true });
  await writeFile(join(run, 'manifest.json'), JSON.stringify({ version: 'visual-benchmark-v1', run_id: 'synthetic', overlap: ['acme'], entities: [{ entity_id: 'acme', qa_overlap: true }] }));
  for (const path of ['captures/acme/desktop-light-top.png', 'captures/acme/overlays/instances.png', 'captures/acme/element-crops/header.png', 'assets/acme.png']) await writeFile(join(run, path), PNG);
  await writeFile(join(run, 'assets', 'unsafe.svg'), '<svg><script>alert(1)</script></svg>');
  await jsonl(join(run, 'entities.jsonl'), [{ entity_id: 'acme', name: 'Acme', website: 'https://acme.example', final_url: 'https://acme.example/home', identity_status: 'current', reachability: 'live_html' }]);
  await jsonl(join(run, 'candidates.jsonl'), [
    { entity_id: 'acme', candidate_id: 'candidate-raster', asset_path: 'assets/acme.png', source: 'header-img', width: 400, height: 100, role_scores: { wide: 12.5 }, score_reasons: ['header', 'home-linked'], rejections: [] },
    { entity_id: 'acme', candidate_id: 'candidate-svg', asset_path: 'assets/unsafe.svg', source: 'inline-svg', score_reasons: ['inline'] },
  ]);
  await jsonl(join(run, 'visual-instances.jsonl'), [{ entity_id: 'acme', visual_instance_id: 'header-1', crop_path: 'captures/acme/element-crops/header.png', overlay_path: 'captures/acme/overlays/instances.png', candidate_id: 'candidate-raster', mapping_type: 'exact' }]);
  await jsonl(join(run, 'mappings.jsonl'), [{ entity_id: 'acme', mapping_id: 'mapping-header-1', visual_instance_id: 'header-1', candidate_id: 'candidate-raster', mapping_confidence: 'exact' }]);
  await writeFile(join(run, 'captures', 'acme', 'page.json'), JSON.stringify({ entity_id: 'acme', screenshots: [{ path: 'captures/acme/desktop-light-top.png', label: 'desktop light top' }] }));
  return run;
}

async function actualCaptureRun() {
  const run = await mkdtemp(join(tmpdir(), 'logo-yoink-visual-capture-packet-'));
  const entityDirectory = join(run, 'captures', 'capture-acme');
  await mkdir(join(entityDirectory, 'element-crops'), { recursive: true });
  await mkdir(join(entityDirectory, 'overlays'), { recursive: true });
  for (const path of ['desktop-light-top.png', 'desktop-light-full-001.png', 'desktop-light-overlay.png', 'element-crops/desktop-light-crop-001.png']) await writeFile(join(entityDirectory, path), PNG);
  await writeFile(join(run, 'manifest.json'), JSON.stringify({ schema_version: 1, capture_version: 'visual-capture-v1', name: 'visual-benchmark-v1' }));
  await writeFile(join(entityDirectory, 'page.json'), JSON.stringify({
    schema_version: 1,
    capture_version: 'visual-capture-v1',
    complete: true,
    entity_id: 'capture-acme',
    requested: { name: 'Capture Acme', website: 'https://capture-acme.example' },
    final_url: 'https://capture-acme.example/',
    views: [{
      view: 'desktop-light', theme: 'light', viewport: { width: 1440, height: 1000 },
      top: { path: 'captures/capture-acme/desktop-light-top.png' },
      full: [{ path: 'captures/capture-acme/desktop-light-full-001.png' }],
      overlay: { path: 'captures/capture-acme/desktop-light-overlay.png' },
      instances: [{ instance_id: 'desktop-light-instance-001', kind: 'img', region: 'header', box: { x: 10, y: 12, width: 120, height: 24 }, visible: true }],
      crops: [{ instance_id: 'desktop-light-instance-001', path: 'captures/capture-acme/element-crops/desktop-light-crop-001.png' }],
    }],
    mappings: [{ instance_id: 'desktop-light-instance-001', mapping: { type: 'exact', url: 'https://capture-acme.example/logo.png' } }],
  }, null, 2));
  return run;
}

test('parses packet options and loads versioned capture records', async () => {
  assert.deepEqual(parseArgs(['--run', 'runs/x', '--output=out', '--overlap', '--resume']), { run: 'runs/x', output: 'out', overlap: true, resume: true });
  const run = await syntheticRun();
  const bundle = await loadBundle(run);
  assert.equal(bundle.manifest.version, 'visual-benchmark-v1');
  assert.equal(bundle.packets.length, 1);
  assert.equal(bundle.packets[0].visual_instances[0].candidate_id, 'candidate-raster');
  assert.equal(bundle.packets[0].visual_instances[0].mapping_id, 'mapping-header-1');
});

test('generates safe exhaustive review packet with empty annotation defaults', async () => {
  const run = await syntheticRun();
  const output = join(run, 'review-packets');
  const result = await buildReviewPacket({ runDirectory: run, outputDirectory: output });
  assert.equal(result.entityCount, 1);
  const index = await readFile(join(output, 'index.html'), 'utf8');
  const entity = await readFile(join(output, 'entities', 'acme.html'), 'utf8');
  assert.match(index, /visual-benchmark-v1/);
  assert.match(index, /entities\/acme\.html/);
  assert.match(entity, /desktop-light-top\.png/);
  assert.match(entity, /instances\.png/);
  assert.match(entity, /header\.png/);
  assert.match(entity, /candidate-raster/);
  assert.match(entity, /No safe raster preview/);
  assert.doesNotMatch(entity, /data-field="best_role"/);
  assert.match(entity, /data-field="roles"[^>]+multiple/);
  assert.match(entity, /data-field="best_for_role"[^>]+multiple/);
  assert.match(entity, /data-field="missing_cause"/);
  assert.match(entity, /data-field="confidence"/);
  assert.match(entity, /data-field="note"/);
  assert.match(entity, /data-record-type="visual-instance"/);
  assert.match(entity, /data-identity-mode="inherited-exact"/);
  assert.equal((entity.match(/<h2>Non-exact observations needing review/g) || []).length, 1);
  assert.equal((entity.match(/<h2>Exact-mapped instances with inherited identity/g) || []).length, 1);
  assert.match(entity, /Identity inherited from candidate/);
  assert.match(entity, /identity_derivation/);
  assert.match(entity, /data-record-type="review-attestation"/);
  assert.match(entity, /Positive-first review guide/);
  assert.match(entity, /padded square canvas whose visible content is symbol-left\/text-right/);
  assert.match(entity, /decorations, UI controls, backgrounds, content imagery/);
  assert.match(entity, /data-record-type="candidate"/);
  assert.match(entity, /data-record-type="missing-role"/);
  assert.match(entity, /record_type: 'label'/);
  assert.match(entity, /label_id: labelIdFor/);
  assert.match(entity, /label_kind: labelKind/);
  assert.match(entity, /reviewer_id: reviewer/);
  assert.match(entity, /prompt_version: WORKFLOW_VERSION/);
  assert.match(entity, /ROLES\.map\(role => \[role, best\.includes\(role\)\]\)/);
  assert.match(entity, /Object\.fromEntries\(\[\.\.\.form\.querySelectorAll/);
  assert.doesNotMatch(entity, /<svg/i);
  assert.doesNotMatch(entity, /data:image\//i);
  assert.doesNotMatch(entity, /<option[^>]+selected/i);
  assert.match(entity, /visual-benchmark-v1/);
  assert.match(entity, /JSONL/);
  assert.doesNotMatch(entity, /data-field="[^"]+-[^"]+"/);
  assert.doesNotMatch(entity, />UI-control</);
  assert.doesNotMatch(entity, /data-field="first_party"/);
});

test('keeps ambiguous redirect candidate evidence auditable as an explicit abstention', async () => {
  const run = await syntheticRun();
  await jsonl(join(run, 'entities.jsonl'), [{ entity_id: 'acme', name: 'Acme', website: 'https://acme.example', final_url: 'https://forsale.example/acme', identity_status: 'ambiguous', reachability: 'redirected_off_domain' }]);
  const bundle = await loadBundle(run);
  assert.equal(bundle.packets[0].captured_candidate_count, 2);
  assert.equal(bundle.packets[0].candidates.length, 0);
  assert.match(bundle.packets[0].candidate_abstention, /ambiguous/);
  await buildReviewPacket({ runDirectory: run, outputDirectory: join(run, 'review-packets') });
  const entity = await readFile(join(run, 'review-packets', 'entities', 'acme.html'), 'utf8');
  assert.match(entity, /Explicit abstention/);
  assert.doesNotMatch(entity, /candidate-raster/);
  assert.doesNotMatch(entity, /data-instance-id="header-1"/);
});

test('keeps a current-site generic-exclusion candidate in the review packet', async () => {
  const run = await syntheticRun();
  const candidates = (await readFile(join(run, 'candidates.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  candidates[1].score_reasons = ['generic exclusion (customer or partner logo) -100'];
  await jsonl(join(run, 'candidates.jsonl'), candidates);
  const bundle = await loadBundle(run);
  assert.equal(bundle.packets[0].candidates.length, 2);
  await buildReviewPacket({ runDirectory: run, outputDirectory: join(run, 'review-packets') });
  const entity = await readFile(join(run, 'review-packets', 'entities', 'acme.html'), 'utf8');
  assert.match(entity, /candidate-svg/);
});

test('refuses accidental packet overwrite unless explicitly resumed', async () => {
  const run = await syntheticRun();
  const output = join(run, 'review-packets');
  await buildReviewPacket({ runDirectory: run, outputDirectory: output });
  await assert.rejects(() => buildReviewPacket({ runDirectory: run, outputDirectory: output }), /Refusing to overwrite/);
  await assert.doesNotReject(() => buildReviewPacket({ runDirectory: run, outputDirectory: output, resume: true }));
});

test('generates an isolated v4 ranker-safe packet without judgments', async () => {
  const run = await syntheticRun();
  const output = join(run, 'review-packets-v4-ranker-safe');
  const result = await buildReviewPacket({ runDirectory: run, outputDirectory: output, workflowVersion: RANKER_SAFE_REVIEW_VERSION, overlapOnly: true });
  assert.equal(result.entityCount, 1);
  const entity = await readFile(join(output, 'entities', 'acme.html'), 'utf8');
  assert.match(entity, /data-review-version="visual-review-packet-v4-ranker-safe"/);
  assert.match(entity, /const WORKFLOW_VERSION = "visual-review-packet-v4-ranker-safe"/);
  assert.match(entity, /quality defects cannot describe evidence limits/);
  assert.doesNotMatch(entity, /label_id: 'label-[0-9a-f]{8}'/);
});

test('consumes actual visual-capture page views when standardized JSONLs are absent', async () => {
  const run = await actualCaptureRun();
  const bundle = await loadBundle(run);
  assert.equal(bundle.packets[0].name, 'Capture Acme');
  assert.equal(bundle.packets[0].website, 'https://capture-acme.example');
  assert.equal(bundle.packets[0].visual_instances[0].visual_instance_id, 'desktop-light-instance-001');
  assert.match(bundle.packets[0].visual_instances[0].crop_path, /desktop-light-crop-001\.png$/);
  assert.match(bundle.packets[0].visual_instances[0].overlay_path, /desktop-light-overlay\.png$/);
  assert.equal(bundle.packets[0].visual_instances[0].mapping.mapping.type, 'exact');
  const result = await buildReviewPacket({ runDirectory: run, outputDirectory: join(run, 'review-packets') });
  const entity = await readFile(join(run, 'review-packets', 'entities', 'capture-acme.html'), 'utf8');
  assert.match(entity, /desktop-light-top\.png/);
  assert.match(entity, /desktop-light-full-001\.png/);
  assert.match(entity, /desktop-light-overlay\.png/);
  assert.match(entity, /desktop-light-crop-001\.png/);
  assert.match(entity, /desktop-light-instance-001/);
  assert.match(entity, /unmapped · exact/);
  assert.match(entity, /Is this a visible logo\/brand mark of Capture Acme\?/);
  assert.match(entity, /Genuinely unclear/);
  assert.match(entity, /identityForBrandMarkDecision\('no'\)/);
  assert.match(entity, /capture-acme\.example/);
  assert.match(entity, /data-capture-version="visual-capture-v1"/);
  const inlineScript = entity.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inlineScript);
  assert.doesNotThrow(() => new Function(inlineScript));
  assert.equal(result.entityCount, 1);
});

test('loads worker capture roots from capture-manifest.json', async () => {
  const run = await actualCaptureRun();
  await unlink(join(run, 'manifest.json'));
  await writeFile(join(run, 'capture-manifest.json'), JSON.stringify({
    schema_version: 'visual-benchmark-v1',
    benchmark_version: 1,
    capture_version: 'visual-capture-v1',
    assignment_manifest: null,
    fixture: null,
    generated_at: '2026-08-23T00:00:00.000Z',
    shard_count: 1,
    shard_index: 0,
    assigned_count: 1,
    entity_ids: ['capture-acme'],
    aggregate_files: { captures: 'captures.jsonl', candidates: 'candidates.jsonl', visual_instances: 'visual-instances.jsonl', mappings: 'mappings.jsonl', rejections: 'rejections.jsonl' },
  }));
  const bundle = await loadBundle(run);
  assert.equal(bundle.manifest.capture_version, 'visual-capture-v1');
  const result = await buildReviewPacket({ runDirectory: run, outputDirectory: join(run, 'review-packets') });
  assert.equal(result.entityCount, 1);
});

test('scopes overlap labels by reviewer while retaining a stable target key', () => {
  const target = targetKeyFor({ labelKind: 'visual_instance', entityId: 'acme', visualInstanceId: 'header-1', candidateId: 'candidate-raster', role: 'wide' });
  const first = labelIdFor({ runKey: 'run-1', captureKey: 'capture-1', passId: 'overlap', reviewerId: 'reviewer-a', targetKey: target });
  const second = labelIdFor({ runKey: 'run-1', captureKey: 'capture-1', passId: 'overlap', reviewerId: 'reviewer-b', targetKey: target });
  assert.equal(target, targetKeyFor({ labelKind: 'visual_instance', entityId: 'acme', visualInstanceId: 'header-1', candidateId: 'candidate-raster', role: 'wide' }));
  assert.notEqual(first, second);
  assert.notEqual(draftStorageKey({ runKey: 'run-1', captureKey: 'capture-1', passId: 'overlap', reviewerId: 'reviewer-a' }), draftStorageKey({ runKey: 'run-1', captureKey: 'capture-1', passId: 'overlap', reviewerId: 'reviewer-b' }));
  assert.notEqual(draftStorageKey({ runKey: 'run-1', captureKey: 'capture-1', passId: 'overlap', reviewerId: 'reviewer-a' }), draftStorageKey({ runKey: 'run-1', captureKey: 'capture-1', passId: 'primary', reviewerId: 'reviewer-a' }));
  assert.notEqual(draftStorageKey({ runKey: 'run-1', captureKey: 'capture-1', passId: 'overlap', reviewerId: 'reviewer-a' }), draftStorageKey({ runKey: 'run-1', captureKey: 'capture-2', passId: 'overlap', reviewerId: 'reviewer-a' }));
});

test('overlap packet selection is manifest-driven and does not create label files', async () => {
  const run = await syntheticRun();
  const output = join(run, 'overlap-review');
  const result = await buildReviewPacket({ runDirectory: run, outputDirectory: output, overlapOnly: true, reviewerId: 'reviewer-a', reviewerKind: 'human', passId: 'round3' });
  assert.equal(result.entityCount, 1);
  assert.deepEqual((await readdir(output)).sort(), ['assets', 'entities', 'index.html']);
});

test('canonical helper validates every review form row and keeps candidate roles distinct', () => {
  const context = { runKey: 'run-1', captureKey: 'capture-1', passId: 'overlap', reviewerId: 'reviewer-a', reviewerKind: 'luna' };
  const sources = [
    { label_kind: 'entity', entity_id: 'acme', values: { identity_status: 'current', graphic_logo_present: 'true' } },
    { label_kind: 'candidate', entity_id: 'acme', candidate_id: 'candidate-logo', values: { best_role: 'wide', roles: ['icon', 'wide'], best_for_role: { wide: true }, identity: 'correct', usability_light: 'good', usability_dark: 'conditional', provenance_quality: 'visible_exact_use' } },
    { label_kind: 'visual_instance', entity_id: 'acme', visual_instance_id: 'header-1', role: 'horizontal_lockup', values: { identity: 'correct', visual_role: 'horizontal_lockup', region: 'header', theme: 'light', visibility: 'good', first_party: 'yes', mapping_confidence: 'exact' } },
    { label_kind: 'missing_role', entity_id: 'acme', role: 'favicon', values: { missing_cause: 'asset_visible_not_discovered', confidence: 'high' } },
  ];
  for (const [index, source] of sources.entries()) {
    const row = normalizeLabelRecord(source, { ...context, reviewerId: `reviewer-${index}` });
    assert.doesNotThrow(() => validateCanonicalLabel(row), `${source.label_kind} row must be canonical`);
  }
});

test('uses a verified PNG preview for SVG candidates and displays persisted rejection evidence', async () => {
  const run = await syntheticRun();
  await writeFile(join(run, 'candidates.jsonl'), [
    { entity_id: 'acme', candidate_id: 'candidate-svg', asset_path: 'assets/unsafe.svg', preview_path: 'assets/acme.png', source: 'inline-svg', score_reasons: ['inline'] },
  ].map(record => JSON.stringify(record)).join('\n') + '\n');
  await jsonl(join(run, 'rejections.jsonl'), [{ entity_id: 'acme', rejection_id: 'reject-1', candidate_id: 'candidate-svg', stage: 'validation', reason: 'unsafe SVG rejected' }]);
  const output = join(run, 'review-packets');
  await buildReviewPacket({ runDirectory: run, outputDirectory: output });
  const entity = await readFile(join(output, 'entities', 'acme.html'), 'utf8');
  assert.match(entity, /candidate-svg/);
  assert.match(entity, /unsafe SVG rejected/);
  assert.match(entity, /data-source-name="acme\.png"/);
  assert.doesNotMatch(entity, /<svg/i);
});

test('packet output outside the capture run uses packet-local assets only', async () => {
  const run = await syntheticRun();
  const output = await mkdtemp(join(tmpdir(), 'logo-yoink-review-output-'));
  await buildReviewPacket({ runDirectory: run, outputDirectory: output });
  const entity = await readFile(join(output, 'entities', 'acme.html'), 'utf8');
  for (const href of [...entity.matchAll(/src="([^"]+)"/g)].map(match => match[1])) assert.equal(resolve(join(output, 'entities'), href).startsWith(resolve(output)), true);
  assert.equal((await readdir(join(output, 'assets'))).length > 0, true);
});
