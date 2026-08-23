import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assignBenchmark, generateShards } from '../scripts/visual-benchmark-shards.mjs';
import { validateRun } from '../scripts/visual-benchmark-validate.mjs';
import { mergeRuns } from '../scripts/visual-benchmark-merge.mjs';

const companyFixture = new URL('../fixtures/companies-500.json', import.meta.url).pathname;
const pilotFixture = new URL('../fixtures/visual-benchmark-pilot-20.json', import.meta.url).pathname;

test('benchmark assignment is deterministic and complete', () => {
  const companies = Array.from({ length: 500 }, (_, index) => ({ entity_id: `entity-${index}`, name: `Company ${index}`, website: `company-${index}.example`, cohort: index < 100 ? 'original-100' : 'additional-400' }));
  const first = assignBenchmark(companies);
  const second = assignBenchmark([...companies].reverse());
  assert.deepEqual(first, second);
  assert.deepEqual(first.counts, { total: 500, development: 300, validation: 100, evaluation: 100, shards: 10, overlap: 100 });
  assert.equal(new Set(first.assignments.map(row => row.entity_id)).size, 500);
  assert.equal(first.assignments.filter(row => row.qa_overlap).length, 100);
  assert.deepEqual(first.assignments.reduce((counts, row) => { counts[row.capture_shard] = (counts[row.capture_shard] ?? 0) + 1; return counts; }, {}), Object.fromEntries(Array.from({ length: 10 }, (_, index) => [index, 50])));
});

test('generated 500-company and pilot manifests validate', async () => {
  const full = await mkdtemp(join(tmpdir(), 'logo-yoink-benchmark-'));
  const pilot = await mkdtemp(join(tmpdir(), 'logo-yoink-pilot-'));
  await generateShards({ inputPath: companyFixture, pilotPath: pilotFixture, outputPath: full });
  await generateShards({ inputPath: companyFixture, pilotPath: pilotFixture, pilotOnly: true, outputPath: pilot });
  const pilotManifest = JSON.parse(await readFile(join(pilot, 'benchmark-manifest.json'), 'utf8'));
  assert.equal(pilotManifest.pilot_entity_ids.length, 20);
  assert.equal(pilotManifest.pilot_external_controls.length, 2);
  assert.ok(!pilotManifest.entities.some(row => row.entity_id.startsWith('external-')));
  assert.deepEqual(await validateRun(full, { strict: true }), { total: 500, splits: { development: 300, validation: 100, evaluation: 100 }, shards: 10, overlap: 100, records: 500 });
  assert.deepEqual(await validateRun(pilot, { strict: true }), { total: 20, splits: { development: 12, validation: 4, evaluation: 4 }, shards: 10, overlap: 4, records: 20 });
});

test('validator rejects incomplete shard ownership', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logo-yoink-invalid-'));
  await generateShards({ inputPath: companyFixture, outputPath: directory });
  const manifestPath = join(directory, 'benchmark-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.shards[0].entity_ids.pop();
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  await assert.rejects(() => validateRun(directory), /entity_count mismatch|Shard ownership is incomplete/);
});

test('merge rejects duplicate record IDs rather than last-write-wins', async () => {
  const first = await mkdtemp(join(tmpdir(), 'logo-yoink-merge-a-'));
  const second = await mkdtemp(join(tmpdir(), 'logo-yoink-merge-b-'));
  const output = await mkdtemp(join(tmpdir(), 'logo-yoink-merge-out-'));
  await generateShards({ inputPath: companyFixture, outputPath: first });
  await generateShards({ inputPath: companyFixture, outputPath: second });
  const candidate = { schema_version: 'visual-benchmark-v1', record_type: 'candidate', candidate_id: 'candidate-1', entity_id: JSON.parse(await readFile(join(first, 'benchmark-manifest.json'), 'utf8')).entities[0].entity_id, source_type: 'img', provenance: { schema_version: 'visual-benchmark-v1', capture_version: 'test' } };
  await writeFile(join(first, 'candidates.jsonl'), `${JSON.stringify(candidate)}\n`);
  await writeFile(join(second, 'candidates.jsonl'), `${JSON.stringify({ ...candidate, source_url: 'https://different.example/logo.svg' })}\n`);
  await assert.rejects(() => mergeRuns([first, second], output), /Duplicate\/conflicting entity assignment/);
});

test('merge accepts two disjoint workers sharing one assignment manifest', async () => {
  const first = await mkdtemp(join(tmpdir(), 'logo-yoink-worker-a-'));
  const second = await mkdtemp(join(tmpdir(), 'logo-yoink-worker-b-'));
  const output = await mkdtemp(join(tmpdir(), 'logo-yoink-worker-out-'));
  await generateShards({ inputPath: companyFixture, outputPath: first });
  await generateShards({ inputPath: companyFixture, outputPath: second });
  const firstManifest = JSON.parse(await readFile(join(first, 'benchmark-manifest.json'), 'utf8'));
  const firstId = firstManifest.shards[0].entity_ids[0];
  const secondId = firstManifest.shards[1].entity_ids[0];
  for (let shard = 1; shard < 10; shard += 1) await rm(join(first, 'workers', `capture-${String(shard).padStart(2, '0')}`), { recursive: true, force: true });
  for (let shard = 2; shard < 10; shard += 1) await rm(join(second, 'workers', `capture-${String(shard).padStart(2, '0')}`), { recursive: true, force: true });
  await rm(join(second, 'workers', 'capture-00'), { recursive: true, force: true });
  const candidate = id => ({ schema_version: 'visual-benchmark-v1', record_type: 'candidate', candidate_id: `candidate-${id}`, entity_id: id, source_type: 'img', content_hash: null, provenance: { schema_version: 'visual-benchmark-v1', capture_version: 'test', task_id: `worker-${id}` } });
  await writeFile(join(first, 'candidates.jsonl'), `${JSON.stringify(candidate(firstId))}\n`);
  await writeFile(join(second, 'candidates.jsonl'), `${JSON.stringify(candidate(secondId))}\n`);
  const result = await mergeRuns([first, second], output);
  assert.equal(result.manifest.assignment_digest, firstManifest.assignment_digest);
  assert.equal(result.recordCount, 2);
  assert.deepEqual((await validateRun(output)).splits, { development: 300, validation: 100, evaluation: 100 });
});

test('validator reads nested shard labels and rejects split corruption', async () => {
  const run = await mkdtemp(join(tmpdir(), 'logo-yoink-nested-labels-'));
  await generateShards({ inputPath: companyFixture, outputPath: run });
  const manifestPath = join(run, 'benchmark-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entityId = manifest.entities[0].entity_id;
  const provenance = { schema_version: 'visual-benchmark-v1', capture_version: 'test', task_id: 'label-task' };
  await writeFile(join(run, manifest.shards[0].label_file), `${JSON.stringify({ schema_version: 'visual-benchmark-v1', record_type: 'label', label_id: 'nested-label', label_kind: 'entity', entity_id: entityId, reviewer_id: 'reviewer-a', reviewer_kind: 'luna', reviewed_at: '2026-08-23T00:00:00.000Z', provenance })}\n`);
  const summary = await validateRun(run);
  assert.equal(summary.records, 501);
  const splitPath = join(run, manifest.split_files.development);
  const splitRows = (await readFile(splitPath, 'utf8')).trim().split('\n').map(JSON.parse);
  splitRows[0].benchmark_split = 'evaluation';
  await writeFile(splitPath, `${splitRows.map(row => JSON.stringify(row)).join('\n')}\n`);
  await assert.rejects(() => validateRun(run), /not assigned to development|assignment differs/);
});

test('validator reports cross-split content hashes unless explicitly grouped', async () => {
  const run = await mkdtemp(join(tmpdir(), 'logo-yoink-hash-leak-'));
  await generateShards({ inputPath: companyFixture, outputPath: run });
  const manifest = JSON.parse(await readFile(join(run, 'benchmark-manifest.json'), 'utf8'));
  const first = manifest.entities.find(row => row.benchmark_split === 'development');
  const second = manifest.entities.find(row => row.benchmark_split === 'validation');
  const provenance = { schema_version: 'visual-benchmark-v1', capture_version: 'test' };
  const hash = 'a'.repeat(64);
  const row = (entity, suffix) => ({ schema_version: 'visual-benchmark-v1', record_type: 'candidate', candidate_id: `candidate-${suffix}`, entity_id: entity.entity_id, source_type: 'img', content_hash: hash, provenance });
  await writeFile(join(run, 'candidates.jsonl'), `${JSON.stringify(row(first, 'one'))}\n${JSON.stringify(row(second, 'two'))}\n`);
  await assert.rejects(() => validateRun(run), /crosses benchmark splits/);
  manifest.content_hash_groups = [{ group_id: 'shared-logo', content_hashes: [hash], entity_ids: [first.entity_id, second.entity_id], split_policy: 'diagnostic_cross_split' }];
  await writeFile(join(run, 'benchmark-manifest.json'), `${JSON.stringify(manifest)}\n`);
  const summary = await validateRun(run);
  assert.equal(summary.content_hash_leaks[0].group_id, 'shared-logo');
});

test('manifest-authorized merge materializes worker assets and captures', async () => {
  const frozen = await mkdtemp(join(tmpdir(), 'logo-yoink-frozen-'));
  const workerA = await mkdtemp(join(tmpdir(), 'logo-yoink-worker-a-'));
  const workerB = await mkdtemp(join(tmpdir(), 'logo-yoink-worker-b-'));
  const output = await mkdtemp(join(tmpdir(), 'logo-yoink-materialized-'));
  await generateShards({ inputPath: companyFixture, outputPath: frozen });
  const manifestPath = join(frozen, 'benchmark-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const manifestDigest = createHash('sha256').update(await readFile(manifestPath)).digest('hex');
  const entities = [manifest.shards[0].entity_ids[0], manifest.shards[1].entity_ids[0]];
  const png = Buffer.from('capture-proof');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>');
  const assetHash = createHash('sha256').update(svg).digest('hex');
  const provenance = { schema_version: 'visual-benchmark-v1', capture_version: 'test', task_id: 'worker-task' };
  for (const [index, root] of [workerA, workerB].entries()) {
    const entityId = entities[index];
    await mkdir(join(root, 'assets'), { recursive: true });
    await mkdir(join(root, 'captures', entityId), { recursive: true });
    await writeFile(join(root, 'assets', `${assetHash}.svg`), svg);
    await writeFile(join(root, 'captures', entityId, 'page.json'), png);
    await writeFile(join(root, 'capture-manifest.json'), JSON.stringify({ schema_version: 'visual-benchmark-v1', record_type: 'capture_manifest', benchmark_version: 1, capture_version: 'test', assignment_manifest: '../../benchmark-manifest.json', assignment_manifest_digest: manifestDigest, generated_at: '2026-08-23T00:00:00.000Z', shard_count: 10, shard_index: index, owned_shards: [{ shard_id: index, entity_ids: [entityId], entity_count: 1 }], entity_count: 1, assigned_count: 1, entity_ids: [entityId], completed_entity_ids: [entityId], aggregate_files: { captures: 'captures.jsonl', candidates: 'candidates.jsonl', visual_instances: 'visual-instances.jsonl' }, provenance }, null, 2));
    await writeFile(join(root, 'captures.jsonl'), `${JSON.stringify({ schema_version: 'visual-benchmark-v1', record_type: 'entity_capture', entity_id: entityId, company_name: 'Company', requested_website: 'https://example.test', capture_status: 'success', identity_status: 'current', reachability: 'live_first_party', captured_at: '2026-08-23T00:00:00.000Z', provenance })}\n`);
    await writeFile(join(root, 'candidates.jsonl'), `${JSON.stringify({ schema_version: 'visual-benchmark-v1', record_type: 'candidate', candidate_id: `candidate-${entityId}`, entity_id: entityId, source_type: 'img', content_hash: assetHash, asset_path: `assets/${assetHash}.svg`, provenance })}\n`);
    await writeFile(join(root, 'visual-instances.jsonl'), `${JSON.stringify({ schema_version: 'visual-benchmark-v1', record_type: 'visual_instance', visual_instance_id: `visual-${entityId}`, entity_id: entityId, view: 'desktop-light', visual_role: 'horizontal_lockup', region: 'header', theme: 'light', visibility: 'good', instance_box: { x: 0, y: 0, width: 2, height: 2 }, candidate_id: `candidate-${entityId}`, screenshot_path: `captures/${entityId}/page.json`, overlay_path: `captures/${entityId}/page.json`, crop_path: `captures/${entityId}/page.json`, provenance })}\n`);
  }
  const result = await mergeRuns([workerA, workerB], output, { manifestPath });
  assert.equal(result.recordCount, 6);
  for (const entityId of entities) {
    assert.ok(await readFile(join(output, 'captures', entityId, 'page.json')));
    assert.ok(await readFile(join(output, 'assets', `${assetHash}.svg`)));
  }
  assert.deepEqual((await validateRun(output)).splits, { development: 300, validation: 100, evaluation: 100 });
});

test('integration records validate IDs, references, and provenance', async () => {
  const run = await mkdtemp(join(tmpdir(), 'logo-yoink-integration-'));
  await generateShards({ inputPath: companyFixture, outputPath: run });
  const entityId = JSON.parse(await readFile(join(run, 'benchmark-manifest.json'), 'utf8')).entities[0].entity_id;
  const provenance = { schema_version: 'visual-benchmark-v1', capture_version: 'visual-capture-v1', extractor_revision: 'test', task_id: 'capture-00', model: null, prompt_version: null, captured_at: '2026-08-23T00:00:00.000Z' };
  const candidate = { schema_version: 'visual-benchmark-v1', record_type: 'candidate', candidate_id: 'candidate-acme', entity_id: entityId, source_type: 'img', source_url: 'https://example.test/logo.png', provenance };
  const instance = { schema_version: 'visual-benchmark-v1', record_type: 'visual_instance', visual_instance_id: 'instance-acme', entity_id: entityId, view: 'desktop-light', visual_role: 'horizontal_lockup', region: 'header', theme: 'light', visibility: 'good', instance_box: { x: 10, y: 12, width: 120, height: 24 }, candidate_id: candidate.candidate_id, provenance };
  const mapping = { schema_version: 'visual-benchmark-v1', record_type: 'mapping', mapping_id: 'mapping-acme', entity_id: entityId, visual_instance_id: instance.visual_instance_id, candidate_id: candidate.candidate_id, mapping_confidence: 'exact', provenance };
  const label = { schema_version: 'visual-benchmark-v1', record_type: 'label', label_id: 'label-acme', label_kind: 'candidate', entity_id: entityId, candidate_id: candidate.candidate_id, reviewer_id: 'luna-00', reviewer_kind: 'luna', reviewed_at: '2026-08-23T00:00:00.000Z', confidence: 0.95, provenance: { ...provenance, prompt_version: 'visual-review-label/v1' } };
  const rejection = { schema_version: 'visual-benchmark-v1', record_type: 'rejection', rejection_id: 'rejection-acme', entity_id: entityId, candidate_id: candidate.candidate_id, stage: 'shape_quality', reason: 'not rejected in final run', provenance };
  await writeFile(join(run, 'captures.jsonl'), `${JSON.stringify({ schema_version: 'visual-benchmark-v1', record_type: 'entity_capture', entity_id: entityId, company_name: 'Example', requested_website: 'example.test', capture_status: 'success', identity_status: 'current', reachability: 'live_first_party', captured_at: provenance.captured_at, provenance })}\n`);
  await writeFile(join(run, 'candidates.jsonl'), `${JSON.stringify(candidate)}\n`);
  await writeFile(join(run, 'visual-instances.jsonl'), `${JSON.stringify(instance)}\n`);
  await writeFile(join(run, 'mappings.jsonl'), `${JSON.stringify(mapping)}\n`);
  await writeFile(join(run, 'labels.jsonl'), `${JSON.stringify(label)}\n`);
  await writeFile(join(run, 'rejections.jsonl'), `${JSON.stringify(rejection)}\n`);
  const summary = await validateRun(run, { strict: true });
  assert.equal(summary.records, 506);
  const manifestPath = join(run, 'benchmark-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  // A partial evidence set is valid while capture remains resumable.
  manifest.stages.capture = { status: 'pending', required_files: ['captures.jsonl', 'candidates.jsonl', 'visual-instances.jsonl', 'mappings.jsonl', 'rejections.jsonl'] };
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  await assert.doesNotReject(() => validateRun(run, { strict: true }));
  await mkdir(join(run, 'review'), { recursive: true });
  manifest.stages.annotation = { status: 'pending', required_files: ['labels.jsonl'] };
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  await assert.doesNotReject(() => validateRun(run, { strict: true }));
});

test('validator rejects invalid rejection stages and dangling references', async () => {
  const run = await mkdtemp(join(tmpdir(), 'logo-yoink-invalid-records-'));
  await generateShards({ inputPath: companyFixture, outputPath: run });
  const entityId = JSON.parse(await readFile(join(run, 'benchmark-manifest.json'), 'utf8')).entities[0].entity_id;
  const provenance = { schema_version: 'visual-benchmark-v1', capture_version: 'test' };
  await writeFile(join(run, 'mappings.jsonl'), `${JSON.stringify({ schema_version: 'visual-benchmark-v1', record_type: 'mapping', mapping_id: 'dangling', entity_id: entityId, visual_instance_id: 'missing-instance', candidate_id: null, mapping_confidence: 'exact', provenance })}\n`);
  await assert.rejects(() => validateRun(run), /missing visual_instance_id/);
  await writeFile(join(run, 'mappings.jsonl'), '');
  await writeFile(join(run, 'rejections.jsonl'), `${JSON.stringify({ schema_version: 'visual-benchmark-v1', record_type: 'rejection', rejection_id: 'bad-stage', entity_id: entityId, stage: 'not-a-stage', reason: 'bad', provenance })}\n`);
  await assert.rejects(() => validateRun(run), /invalid stage/);
});
