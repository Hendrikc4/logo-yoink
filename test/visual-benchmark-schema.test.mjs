import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assignBenchmark, generateShards } from '../scripts/benchmark/visual-benchmark-shards.mjs';
import { validateRun } from '../scripts/benchmark/visual-benchmark-validate.mjs';
import { mergeRuns } from '../scripts/benchmark/visual-benchmark-merge.mjs';
import { RANKER_SAFE_REVIEW_VERSION, REVIEW_VERSION, identityForBrandMarkDecision, labelIdFor, normalizeLabelRecord, targetKeyFor, validateCanonicalLabel } from '../benchmark/lib/labels.mjs';

const companyFixture = new URL('../fixtures/companies-500.json', import.meta.url).pathname;
const pilotFixture = new URL('../fixtures/visual-benchmark-pilot-20.json', import.meta.url).pathname;

async function jsonl(path, records) {
  await writeFile(path, `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
}

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
  const nestedTarget = targetKeyFor({ labelKind: 'entity', entityId });
  await writeFile(join(run, manifest.shards[0].label_file), `${JSON.stringify({ schema_version: 'visual-benchmark-v1', record_type: 'label', label_id: labelIdFor({ runKey: 'run', captureKey: 'capture', passId: 'default', reviewerId: 'reviewer-a', targetKey: nestedTarget }), target_key: nestedTarget, label_kind: 'entity', entity_id: entityId, values: { identity_status: 'current' }, reviewer_id: 'reviewer-a', reviewer_kind: 'luna', review_pass: 'default', run_key: 'run', capture_key: 'capture', reviewed_at: '2026-08-23T00:00:00.000Z', provenance })}\n`);
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
  const row = (entity, suffix) => ({ schema_version: 'visual-benchmark-v1', record_type: 'candidate', candidate_id: `candidate-${suffix}`, entity_id: entity.entity_id, source_type: 'img', content_hash: hash, score_reasons: ['generic exclusion (customer or partner logo) -100'], provenance });
  const capture = entity => ({ schema_version: 'visual-benchmark-v1', record_type: 'entity_capture', entity_id: entity.entity_id, company_name: entity.name, requested_website: `https://${entity.website}/`, capture_status: 'success', identity_status: 'current', reachability: 'live_first_party', captured_at: '2026-08-23T00:00:00.000Z', provenance });
  await writeFile(join(run, 'candidates.jsonl'), `${JSON.stringify(row(first, 'one'))}\n${JSON.stringify(row(second, 'two'))}\n`);
  await jsonl(join(run, 'captures.jsonl'), [capture(first), capture(second)]);
  await assert.rejects(() => validateRun(run), /crosses benchmark splits/);
  manifest.content_hash_groups = [{ group_id: 'shared-logo', content_hashes: [hash], entity_ids: [first.entity_id, second.entity_id], split_policy: 'diagnostic_cross_split' }];
  await writeFile(join(run, 'benchmark-manifest.json'), `${JSON.stringify(manifest)}\n`);
  const summary = await validateRun(run);
  assert.equal(summary.content_hash_leaks[0].group_id, 'shared-logo');
});

test('validator excludes GoDaddy parked-domain favicon fallbacks from target-content leakage while retaining current-content protection', async () => {
  const run = await mkdtemp(join(tmpdir(), 'logo-yoink-parked-favicon-'));
  await generateShards({ inputPath: companyFixture, outputPath: run });
  const manifest = JSON.parse(await readFile(join(run, 'benchmark-manifest.json'), 'utf8'));
  const current = manifest.entities.find(row => row.benchmark_split === 'development');
  const parked = manifest.entities.find(row => row.benchmark_split === 'evaluation');
  const parkedHash = '44ea786ef9f9ad7f0ee37ab3166580818da36d2cd2721f5a480cc8a06d801fa2';
  const genuineHash = 'b'.repeat(64);
  const provenance = { schema_version: 'visual-benchmark-v1', capture_version: 'test' };
  const candidate = (entity, suffix, content_hash = parkedHash) => ({ schema_version: 'visual-benchmark-v1', record_type: 'candidate', candidate_id: `candidate-${suffix}`, entity_id: entity.entity_id, source_type: 'favicon', source: 'google-favicon', content_hash, provenance });
  const capture = (entity, identity_status, reachability) => ({ schema_version: 'visual-benchmark-v1', record_type: 'entity_capture', entity_id: entity.entity_id, company_name: entity.name, requested_website: `https://${entity.website}/`, capture_status: 'success', identity_status, reachability, captured_at: '2026-08-23T00:00:00.000Z', provenance });
  await jsonl(join(run, 'captures.jsonl'), [capture(current, 'current', 'live_first_party'), capture(parked, 'ambiguous', 'redirected_off_domain')]);
  await jsonl(join(run, 'candidates.jsonl'), [candidate(current, 'current'), candidate(parked, 'parked')]);
  await assert.doesNotReject(() => validateRun(run));
  await jsonl(join(run, 'captures.jsonl'), [capture(current, 'current', 'live_first_party'), capture(parked, 'current', 'live_first_party')]);
  await jsonl(join(run, 'candidates.jsonl'), [candidate(current, 'genuine-current', genuineHash), candidate(parked, 'genuine-second', genuineHash)]);
  await assert.rejects(() => validateRun(run), /crosses benchmark splits/);
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
  const labelTarget = targetKeyFor({ labelKind: 'candidate', entityId, candidateId: candidate.candidate_id });
  const label = { schema_version: 'visual-benchmark-v1', record_type: 'label', label_id: labelIdFor({ runKey: 'run', captureKey: 'capture', passId: 'default', reviewerId: 'luna-00', targetKey: labelTarget }), target_key: labelTarget, label_kind: 'candidate', entity_id: entityId, candidate_id: candidate.candidate_id, values: { identity: 'correct', confidence: 0.95 }, reviewer_id: 'luna-00', reviewer_kind: 'luna', review_pass: 'default', run_key: 'run', capture_key: 'capture', reviewed_at: '2026-08-23T00:00:00.000Z', provenance: { ...provenance, prompt_version: 'visual-review-label/v1' } };
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

test('canonical labels share natural targets but scope IDs to reviewers', () => {
  const source = { schema_version: 'visual-benchmark-v1', record_type: 'label', label_kind: 'candidate', entity_id: 'acme', candidate_id: 'candidate-logo', role: 'wide', values: { 'best-role': 'wide', 'usability-light': 'good' }, reviewer_kind: 'luna', reviewed_at: '2026-08-23T00:00:00.000Z', provenance: { schema_version: 'visual-benchmark-v1', capture_version: 'capture-1', task_id: 'task-1' } };
  const first = normalizeLabelRecord(source, { runKey: 'run-1', captureKey: 'capture-1', passId: 'overlap', reviewerId: 'reviewer-a' });
  const second = normalizeLabelRecord(source, { runKey: 'run-1', captureKey: 'capture-1', passId: 'overlap', reviewerId: 'reviewer-b' });
  assert.equal(first.target_key, second.target_key);
  assert.notEqual(first.label_id, second.label_id);
  assert.equal(first.values.best_role, undefined);
  assert.deepEqual(first.values.best_for_role, { icon: false, wide: true, favicon: false, stacked: false, other: false });
  assert.deepEqual(first.values.roles, ['wide']);
  assert.doesNotThrow(() => validateCanonicalLabel(first));
});

test('v3 workflow provenance preserves the canonical v2 label-ID namespace', () => {
  assert.equal(REVIEW_VERSION, 'visual-review-packet-v3-positive-first');
  assert.equal(labelIdFor({ runKey: 'merged', captureKey: 'visual-capture-v1', passId: 'qa_round2', reviewerId: 'luna-overlap-round2-a', targetKey: 'target-1ef78150' }), 'label-e8a126de');
});

test('positive-first yes/no/unclear decisions serialize to canonical identity', () => {
  assert.deepEqual(['yes', 'no', 'unclear'].map(identityForBrandMarkDecision), ['correct', 'wrong', 'ambiguous']);
  for (const [decision, identity] of [['yes', 'correct'], ['no', 'wrong'], ['unclear', 'ambiguous']]) {
    const row = normalizeLabelRecord({ label_kind: 'visual_instance', entity_id: 'acme', visual_instance_id: `visual-${decision}`, values: { requested_company_brand_mark: decision } }, { runKey: 'run', captureKey: 'capture', passId: 'positive', reviewerId: 'reviewer', reviewerKind: 'human' });
    assert.equal(row.values.identity, identity);
    assert.equal(row.values.requested_company_brand_mark, undefined);
    assert.doesNotThrow(() => validateCanonicalLabel(row));
  }
});

test('validator accepts exact-mapping identity inheritance and rejects cross-record mismatch', async () => {
  const run = await mkdtemp(join(tmpdir(), 'logo-yoink-derived-label-'));
  await generateShards({ inputPath: companyFixture, outputPath: run });
  const entityId = JSON.parse(await readFile(join(run, 'benchmark-manifest.json'), 'utf8')).entities[0].entity_id;
  const candidateId = 'candidate-derived';
  const visualInstanceId = 'visual-derived';
  const mappingId = 'mapping-derived';
  const provenance = { schema_version: 'visual-benchmark-v1', capture_version: 'capture-derived', task_id: 'review-task', prompt_version: REVIEW_VERSION };
  const context = { runKey: 'run-derived', captureKey: 'capture-derived', passId: 'positive-first', reviewerId: 'reviewer-a', reviewerKind: 'human' };
  const candidateLabel = normalizeLabelRecord({ label_kind: 'candidate', entity_id: entityId, candidate_id: candidateId, values: { identity: 'correct' }, provenance, reviewed_at: '2026-08-23T00:00:00.000Z' }, context);
  const visualLabel = normalizeLabelRecord({
    label_kind: 'visual_instance', entity_id: entityId, visual_instance_id: visualInstanceId, candidate_id: candidateId,
    identity_derivation: { type: 'exact_candidate_mapping', mapping_id: mappingId, candidate_id: candidateId, candidate_label_id: candidateLabel.label_id },
    values: { identity: 'correct' }, provenance, reviewed_at: '2026-08-23T00:00:00.000Z',
  }, context);
  const attestation = normalizeLabelRecord({ label_kind: 'review_attestation', entity_id: entityId, values: { visual_evidence_reviewed: true, review_workflow: 'positive_first', visual_instance_count: 1 }, provenance, reviewed_at: '2026-08-23T00:00:00.000Z' }, context);
  const captureProvenance = { schema_version: 'visual-benchmark-v1', capture_version: 'capture-derived' };
  await jsonl(join(run, 'candidates.jsonl'), [{ schema_version: 'visual-benchmark-v1', record_type: 'candidate', candidate_id: candidateId, entity_id: entityId, source_type: 'img', provenance: captureProvenance }]);
  await jsonl(join(run, 'visual-instances.jsonl'), [{ schema_version: 'visual-benchmark-v1', record_type: 'visual_instance', visual_instance_id: visualInstanceId, entity_id: entityId, view: 'desktop-light', visual_role: 'horizontal_lockup', region: 'header', theme: 'light', visibility: 'good', instance_box: { x: 0, y: 0, width: 120, height: 24 }, candidate_id: candidateId, provenance: captureProvenance }]);
  const mapping = { schema_version: 'visual-benchmark-v1', record_type: 'mapping', mapping_id: mappingId, entity_id: entityId, visual_instance_id: visualInstanceId, candidate_id: candidateId, mapping_confidence: 'exact', provenance: captureProvenance };
  await jsonl(join(run, 'mappings.jsonl'), [mapping]);
  await jsonl(join(run, 'labels.jsonl'), [candidateLabel, visualLabel, attestation]);
  await assert.doesNotReject(() => validateRun(run, { strict: true }));
  visualLabel.values.identity = 'wrong';
  await jsonl(join(run, 'labels.jsonl'), [candidateLabel, visualLabel, attestation]);
  await assert.rejects(() => validateRun(run, { strict: true }), /identity does not match candidate label/);
  visualLabel.values.identity = 'correct';
  mapping.mapping_confidence = 'derived';
  await jsonl(join(run, 'mappings.jsonl'), [mapping]);
  await jsonl(join(run, 'labels.jsonl'), [candidateLabel, visualLabel, attestation]);
  await assert.rejects(() => validateRun(run, { strict: true }), /does not match its exact mapping/);
  mapping.mapping_confidence = 'exact';
  await jsonl(join(run, 'mappings.jsonl'), [mapping]);
  const otherReviewerLabel = normalizeLabelRecord({ label_kind: 'candidate', entity_id: entityId, candidate_id: candidateId, values: { identity: 'correct' }, provenance, reviewed_at: '2026-08-23T00:00:00.000Z' }, { ...context, reviewerId: 'reviewer-b' });
  visualLabel.identity_derivation.candidate_label_id = otherReviewerLabel.label_id;
  await jsonl(join(run, 'labels.jsonl'), [candidateLabel, otherReviewerLabel, visualLabel, attestation]);
  await assert.rejects(() => validateRun(run, { strict: true }), /outside the same reviewer\/pass scope/);
});

test('canonical validator rejects legacy hyphenated and stale target keys', () => {
  const target = targetKeyFor({ labelKind: 'entity', entityId: 'acme' });
  const label = { schema_version: 'visual-benchmark-v1', record_type: 'label', label_id: labelIdFor({ runKey: 'run', captureKey: 'capture', reviewerId: 'reviewer', targetKey: target }), target_key: 'target-stale', label_kind: 'entity', entity_id: 'acme', values: { 'identity-status': 'current' }, reviewer_id: 'reviewer', reviewer_kind: 'luna', review_pass: 'default', run_key: 'run', capture_key: 'capture', reviewed_at: '2026-08-23T00:00:00.000Z', provenance: { schema_version: 'visual-benchmark-v1', capture_version: 'capture' } };
  assert.throws(() => validateCanonicalLabel(label), /target_key mismatch/);
});

test('legacy normalization covers pilot aliases, sentinels, arrays, and metadata', () => {
  const candidate = normalizeLabelRecord({
    label_kind: 'candidate', entity_id: 'acme', candidate_id: 'candidate-1', role: 'wide',
    values: {
      identity_correctness: 'correct', applicable_roles: ['wide', 'favicon'], quality_defects: 'none',
      best_for_role: { wide: true, favicon: false }, usability_light: 'good', usability_dark: 'conditional',
      provenance_quality: 'inferred_first_party', reject_reason: null, confidence: 0.9,
      display_name: 'discarded evidence metadata', notes: 'legacy note',
    }, reviewer_id: 'reviewer-a', reviewer_kind: 'luna', review_pass: 'primary', run_key: 'run', capture_key: 'capture',
    provenance: { schema_version: 'visual-benchmark-v1', capture_version: 'capture' },
  });
  assert.deepEqual(candidate.values.roles, ['wide', 'favicon']);
  assert.deepEqual(candidate.values.best_for_role, { icon: false, wide: true, favicon: false, stacked: false, other: false });
  assert.equal(candidate.values.best_role, undefined);
  assert.deepEqual(candidate.values.quality_defects, []);
  assert.equal(candidate.values.identity, 'correct');
  assert.equal(candidate.values.note, 'legacy note');
  assert.equal(candidate.values.display_name, undefined);
  assert.doesNotThrow(() => validateCanonicalLabel(candidate));

  const missing = normalizeLabelRecord({ label_kind: 'missing_role', entity_id: 'acme', role: 'icon', values: { missing: false, cause: null, note: 'available' }, reviewer_id: 'reviewer-a', reviewer_kind: 'luna', review_pass: 'primary', run_key: 'run', capture_key: 'capture', provenance: { schema_version: 'visual-benchmark-v1', capture_version: 'capture' } });
  assert.equal(missing.values.missing_cause, 'not_missing');
  assert.doesNotThrow(() => validateCanonicalLabel(missing));
});

test('target identity excludes reviewer judgment for candidates and visual instances', () => {
  assert.equal(
    targetKeyFor({ labelKind: 'candidate', entityId: 'acme', candidateId: 'candidate-1', role: 'wide' }),
    targetKeyFor({ labelKind: 'candidate', entityId: 'acme', candidateId: 'candidate-1', role: 'favicon' }),
  );
  assert.equal(
    targetKeyFor({ labelKind: 'visual_instance', entityId: 'acme', visualInstanceId: 'visual-1', role: 'symbol' }),
    targetKeyFor({ labelKind: 'visual_instance', entityId: 'acme', visualInstanceId: 'visual-1', role: 'wordmark' }),
  );
  assert.notEqual(
    targetKeyFor({ labelKind: 'missing_role', entityId: 'acme', role: 'icon' }),
    targetKeyFor({ labelKind: 'missing_role', entityId: 'acme', role: 'wide' }),
  );
});

test('v4 ranker-safe normalization turns wrong candidates into safe negatives', () => {
  const row = normalizeLabelRecord({
    label_kind: 'candidate', entity_id: 'acme', candidate_id: 'candidate-wrong',
    values: { identity: 'wrong', roles: ['wide'], best_for_role: { wide: true }, usability_light: 'good', usability_dark: 'conditional' },
    provenance: { schema_version: 'visual-benchmark-v1', capture_version: 'capture', prompt_version: RANKER_SAFE_REVIEW_VERSION },
  }, { runKey: 'run', captureKey: 'capture', passId: 'positive-first', reviewerId: 'reviewer', reviewerKind: 'human' });
  assert.deepEqual(row.values.roles, []);
  assert.deepEqual(row.values.best_for_role, { icon: false, wide: false, favicon: false, stacked: false, other: false });
  assert.equal(row.values.usability_light, 'unusable');
  assert.equal(row.values.usability_dark, 'unusable');
  assert.doesNotThrow(() => validateCanonicalLabel(row));
});

test('v4 ranker-safe validation rejects unsafe candidate judgments and evidence-limit defects', () => {
  const base = {
    schema_version: 'visual-benchmark-v1', record_type: 'label', label_kind: 'candidate', entity_id: 'acme', candidate_id: 'candidate-1',
    label_id: labelIdFor({ runKey: 'run', captureKey: 'capture', passId: 'positive-first', reviewerId: 'reviewer', targetKey: targetKeyFor({ labelKind: 'candidate', entityId: 'acme', candidateId: 'candidate-1' }) }), target_key: targetKeyFor({ labelKind: 'candidate', entityId: 'acme', candidateId: 'candidate-1' }),
    reviewer_id: 'reviewer', reviewer_kind: 'human', review_pass: 'positive-first', run_key: 'run', capture_key: 'capture', reviewed_at: '2026-08-23T00:00:00.000Z',
    provenance: { schema_version: 'visual-benchmark-v1', capture_version: 'capture', prompt_version: RANKER_SAFE_REVIEW_VERSION },
  };
  const best = { icon: false, wide: true, favicon: false, stacked: false, other: false };
  assert.throws(() => validateCanonicalLabel({ ...base, values: { identity: 'wrong', roles: ['wide'], best_for_role: best, usability_light: 'good', usability_dark: 'good' } }), /wrong identity/);
  assert.throws(() => validateCanonicalLabel({ ...base, values: { identity: 'ambiguous', roles: ['wide'], best_for_role: best, usability_light: 'good', usability_dark: 'good' } }), /ambiguous identity/);
  assert.throws(() => validateCanonicalLabel({ ...base, values: { identity: 'correct', roles: [], best_for_role: best, usability_light: 'good', usability_dark: 'good' } }), /requires correct identity/);
  assert.throws(() => validateCanonicalLabel({ ...base, values: { identity: 'correct', roles: ['wide'], best_for_role: best, usability_light: 'unusable', usability_dark: 'unusable' } }), /both unusable/);
  assert.throws(() => validateCanonicalLabel({ ...base, values: { identity: 'correct', roles: ['wide'], best_for_role: { icon: false, wide: false, favicon: false, stacked: false, other: false }, quality_defects: ['no_verified_raster_preview'] } }), /evidence-limit/);
  const legacy = { ...base, provenance: { ...base.provenance, prompt_version: REVIEW_VERSION }, values: { identity: 'wrong', roles: ['wide'], best_for_role: best, usability_light: 'good', usability_dark: 'good' } };
  assert.doesNotThrow(() => validateCanonicalLabel(legacy));
});
