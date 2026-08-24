import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { generateShards } from '../scripts/visual-benchmark-shards.mjs';
import { validateRun } from '../scripts/visual-benchmark-validate.mjs';
import { overlayRemediationRuns, validateRemediationInputs } from '../scripts/visual-benchmark-remediation-merge.mjs';

const fixture = new URL('../fixtures/companies-500.json', import.meta.url).pathname;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const provenance = { schema_version: 'visual-benchmark-v1', capture_version: 'test' };

async function worker(root, id, { candidateId = `candidate-${id}`, bytes = Buffer.from(`asset-${id}`), assetPath = null, missingAsset = false } = {}) {
  await mkdir(join(root, 'captures', id), { recursive: true }); await mkdir(join(root, 'assets'), { recursive: true });
  const asset = assetPath ?? `assets/${hash(bytes)}.svg`; if (!missingAsset) await writeFile(join(root, asset), bytes); await writeFile(join(root, 'captures', id, 'page.png'), Buffer.from('screen'));
  const candidate = { schema_version: 'visual-benchmark-v1', record_type: 'candidate', candidate_id: candidateId, entity_id: id, source_type: 'img', content_hash: hash(bytes), asset_path: asset, provenance };
  const capture = { schema_version: 'visual-benchmark-v1', record_type: 'entity_capture', entity_id: id, company_name: 'Company', requested_website: 'https://example.test', capture_status: 'success', identity_status: 'current', reachability: 'live_first_party', captured_at: '2026-08-23T00:00:00.000Z', artifact_path: `captures/${id}`, provenance };
  const instance = { schema_version: 'visual-benchmark-v1', record_type: 'visual_instance', visual_instance_id: `instance-${id}`, entity_id: id, view: 'desktop-light', visual_role: 'horizontal_lockup', region: 'header', theme: 'light', visibility: 'good', instance_box: { x: 0, y: 0, width: 1, height: 1 }, candidate_id: candidateId, screenshot_path: `captures/${id}/page.png`, provenance };
  const mapping = { schema_version: 'visual-benchmark-v1', record_type: 'mapping', mapping_id: `mapping-${id}`, entity_id: id, visual_instance_id: instance.visual_instance_id, candidate_id: candidateId, mapping_confidence: 'exact', provenance };
  for (const [name, rows] of Object.entries({ captures: [capture], candidates: [candidate], 'visual-instances': [instance], mappings: [mapping], rejections: [] })) await writeFile(join(root, `${name}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n'));
  await writeFile(join(root, 'capture-manifest.json'), JSON.stringify({ schema_version: 'visual-benchmark-v1', record_type: 'capture_manifest', benchmark_version: 1, entity_count: 1, assigned_count: 1, entity_ids: [id], completed_entity_ids: [id], aggregate_files: { captures: 'captures.jsonl', candidates: 'candidates.jsonl', visual_instances: 'visual-instances.jsonl', mappings: 'mappings.jsonl', rejections: 'rejections.jsonl' } }));
}
async function emptyWorker(root) { await mkdir(root, { recursive: true }); await writeFile(join(root, 'capture-manifest.json'), JSON.stringify({ schema_version: 'visual-benchmark-v1', record_type: 'capture_manifest', benchmark_version: 1, entity_count: 0, assigned_count: 0, entity_ids: [], completed_entity_ids: [], aggregate_files: { captures: 'captures.jsonl', candidates: 'candidates.jsonl', visual_instances: 'visual-instances.jsonl', mappings: 'mappings.jsonl', rejections: 'rejections.jsonl' } })); }
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'logo-yoink-remediation-')); const base = join(root, 'base'); await generateShards({ inputPath: fixture, outputPath: base });
  const manifest = JSON.parse(await readFile(join(base, 'benchmark-manifest.json'), 'utf8')); const ids = manifest.entities.slice(0, 2).map(row => row.entity_id); const inputs = ['a', 'b', 'c', 'd'].map(name => join(root, name));
  await worker(inputs[0], ids[0]); await worker(inputs[1], ids[1]); await emptyWorker(inputs[2]); await emptyWorker(inputs[3]); return { root, base, ids, inputs };
}

test('remediation overlay atomically replaces only selected evidence and remains strict-valid', async () => {
  const { root, base, ids, inputs } = await setup(); const retained = Buffer.from('retained-base'); const retainedPath = `assets/${hash(retained)}.svg`; await mkdir(join(base, 'assets'), { recursive: true }); await writeFile(join(base, retainedPath), retained); await writeFile(join(base, 'candidates.jsonl'), `${JSON.stringify({ schema_version: 'visual-benchmark-v1', record_type: 'candidate', candidate_id: 'base-unselected', entity_id: ids[1], source_type: 'img', content_hash: hash(retained), asset_path: retainedPath, provenance })}\n`); const selection = join(root, 'selection.json'); const output = join(root, 'overlay'); await writeFile(selection, JSON.stringify({ selected: [ids[0]] }));
  const result = await overlayRemediationRuns({ base, inputs, selection, output }); assert.deepEqual(result.selected_entity_ids, [ids[0]]);
  const candidates = (await readFile(join(output, 'candidates.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); assert.equal(candidates.length, 2); assert.ok(candidates.some(row => row.entity_id === ids[0])); assert.ok(candidates.some(row => row.candidate_id === 'base-unselected'));
  assert.deepEqual((await validateRun(output, { strict: true })).splits, { development: 300, validation: 100, evaluation: 100 });
  assert.equal(JSON.parse(await readFile(join(output, 'remediation-manifest.json'), 'utf8')).selected_entity_ids[0], ids[0]);
});

test('remediation overlay rejects invalid selection and leaves no partial output', async () => {
  const { root, base, inputs } = await setup(); const selection = join(root, 'selection.json'); const output = join(root, 'overlay'); await writeFile(selection, JSON.stringify(['not-owned']));
  await assert.rejects(() => overlayRemediationRuns({ base, inputs, selection, output }), /not in both base/); await assert.rejects(() => readFile(join(output, 'benchmark-manifest.json')));
});

test('remediation validation rejects duplicate ownership', async () => {
  const { base, ids, inputs } = await setup(); await worker(inputs[2], ids[0], { candidateId: 'duplicate' });
  await assert.rejects(() => validateRemediationInputs({ base, inputs }), /Duplicate remediation ownership/);
});

test('remediation overlay rejects conflicting and missing referenced assets before publication', async () => {
  const first = await setup(); const path = 'assets/shared.svg'; await worker(first.inputs[0], first.ids[0], { assetPath: path, bytes: Buffer.from('retry') });
  await mkdir(join(first.base, 'assets'), { recursive: true }); await writeFile(join(first.base, path), Buffer.from('base')); await writeFile(join(first.base, 'candidates.jsonl'), `${JSON.stringify({ schema_version: 'visual-benchmark-v1', record_type: 'candidate', candidate_id: 'base-candidate', entity_id: first.ids[0], source_type: 'img', content_hash: hash(Buffer.from('base')), asset_path: path, provenance })}\n`);
  const selection = join(first.root, 'selection.json'); await writeFile(selection, JSON.stringify([first.ids[0]])); await assert.rejects(() => overlayRemediationRuns({ base: first.base, inputs: first.inputs, selection, output: join(first.root, 'overlay') }), /Conflicting referenced asset bytes/);
  const second = await setup(); await worker(second.inputs[0], second.ids[0], { assetPath: 'assets/missing.svg', missingAsset: true }); const missing = join(second.root, 'selection.json'); await writeFile(missing, JSON.stringify([second.ids[0]])); await assert.rejects(() => overlayRemediationRuns({ base: second.base, inputs: second.inputs, selection: missing, output: join(second.root, 'overlay') }), /referenced file is missing/);
});
