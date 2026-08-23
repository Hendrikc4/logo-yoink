#!/usr/bin/env node

import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assignmentDigest, assignBenchmark, DEFAULT_SEED, SCHEMA_VERSION } from './visual-benchmark-shards.mjs';

const ENUMS = {
  benchmark_split: new Set(['development', 'validation', 'evaluation']),
  capture_status: new Set(['pending', 'success', 'failure', 'incomplete']),
  identity_status: new Set(['current', 'related_rebrand', 'wrong_site', 'ambiguous', 'unreachable']),
  mapping_confidence: new Set(['exact', 'derived', 'suggested', 'unmapped']),
  stage: new Set(['discovery', 'parse', 'download_budget', 'validation', 'deduplication', 'generic_asset', 'role_eligibility', 'rank_threshold', 'identity_filter', 'shape_quality', 'theme_serialization', 'mapping', 'other']),
};

function argsOf(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) { out._.push(token); continue; }
    const [key, inline] = token.slice(2).split('=', 2);
    if (inline !== undefined) out[key] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function fileExists(path) { try { await access(path); return true; } catch { return false; } }

function confinedPath(root, value, context) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error(`${context}: path must be a non-empty relative string`);
  const candidate = resolve(root, value);
  const rootPath = resolve(root);
  const rel = relative(rootPath, candidate);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || rel.startsWith(sep) || /^[a-z]:/i.test(value) || value.startsWith('/')) throw new Error(`${context}: path escapes benchmark root`);
  return candidate;
}

async function recursiveFiles(root, predicate) {
  const output = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && predicate(path, entry.name)) output.push(path);
    }
  }
  await walk(root);
  return output.sort();
}

async function validateCaptureManifests(root) {
  const paths = await recursiveFiles(root, (path, name) => name === 'capture-manifest.json');
  for (const path of paths) {
    const capture = await readJson(path);
    for (const field of ['schema_version', 'record_type', 'benchmark_version', 'capture_version', 'generated_at', 'shard_count', 'shard_index', 'owned_shards', 'entity_count', 'assigned_count', 'entity_ids', 'completed_entity_ids', 'aggregate_files', 'provenance']) if (capture[field] === undefined || capture[field] === null) throw new Error(`${path}: capture manifest is missing ${field}.`);
    if (capture.schema_version !== SCHEMA_VERSION || capture.record_type !== 'capture_manifest' || capture.benchmark_version !== 1) throw new Error(`${path}: incompatible capture manifest version.`);
    if (!Number.isInteger(capture.entity_count) || capture.entity_count !== capture.assigned_count || capture.entity_count !== capture.entity_ids.length) throw new Error(`${path}: capture entity counts do not agree.`);
    if (!Array.isArray(capture.completed_entity_ids) || capture.completed_entity_ids.some(id => !capture.entity_ids.includes(id))) throw new Error(`${path}: completed_entity_ids contains an unassigned entity.`);
    if (capture.assignment_manifest != null) {
      const target = resolve(dirname(path), capture.assignment_manifest), rootPath = resolve(root), rel = relative(rootPath, target);
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new Error(`${path}: assignment_manifest escapes benchmark root.`);
    }
    for (const [field, value] of Object.entries(capture.aggregate_files)) {
      if (typeof value !== 'string' || !value.trim()) throw new Error(`${path}: aggregate_files.${field} must be a relative path.`);
      const target = resolve(dirname(path), value);
      const rootPath = resolve(root), rel = relative(rootPath, target);
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new Error(`${path}: aggregate_files.${field} escapes benchmark root.`);
    }
    if (!Array.isArray(capture.owned_shards) || capture.owned_shards.some(shard => shard.entity_count !== shard.entity_ids?.length || shard.entity_ids.some(id => !capture.entity_ids.includes(id)))) throw new Error(`${path}: owned_shards do not match entity_ids.`);
  }
  return paths.length;
}

function assignmentEquivalent(a, b) {
  return JSON.stringify({ entity_id: a.entity_id, name: a.name, website: a.website, cohort: a.cohort, benchmark_split: a.benchmark_split, capture_shard: a.capture_shard, label_shard: a.label_shard, qa_overlap: a.qa_overlap, pilot: a.pilot ?? null }) === JSON.stringify({ entity_id: b.entity_id, name: b.name, website: b.website, cohort: b.cohort, benchmark_split: b.benchmark_split, capture_shard: b.capture_shard, label_shard: b.label_shard, qa_overlap: b.qa_overlap, pilot: b.pilot ?? null });
}

export async function readJsonl(path) {
  const text = await readFile(path, 'utf8');
  const rows = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try { rows.push({ row: JSON.parse(line), line: index + 1 }); }
    catch (error) { throw new Error(`${path}:${index + 1}: invalid JSON (${error.message})`); }
  }
  return rows;
}

function requireFields(record, fields, context) {
  for (const field of fields) if (record[field] === undefined || record[field] === null && field !== 'final_url') throw new Error(`${context}: missing required field ${field}`);
}
function enumValue(record, field, context) {
  if (record[field] !== undefined && ENUMS[field] && !ENUMS[field].has(record[field])) throw new Error(`${context}: invalid ${field} ${JSON.stringify(record[field])}`);
}

export function validateRecord(record, context = 'record') {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`${context}: record must be an object`);
  if (record.schema_version !== SCHEMA_VERSION) throw new Error(`${context}: schema_version must be ${SCHEMA_VERSION}`);
  const type = record.record_type;
  const required = {
    capture_assignment: ['entity_id', 'name', 'website', 'cohort', 'benchmark_split', 'capture_shard', 'label_shard', 'qa_overlap'],
    entity_capture: ['entity_id', 'company_name', 'requested_website', 'capture_status', 'identity_status', 'reachability', 'captured_at', 'provenance'],
    candidate: ['candidate_id', 'entity_id', 'source_type', 'provenance'],
    visual_instance: ['visual_instance_id', 'entity_id', 'view', 'visual_role', 'region', 'theme', 'visibility', 'instance_box', 'provenance'],
    mapping: ['mapping_id', 'entity_id', 'visual_instance_id', 'mapping_confidence', 'provenance'],
    label: ['label_id', 'label_kind', 'entity_id', 'reviewer_id', 'reviewer_kind', 'reviewed_at', 'provenance'],
    adjudication: ['adjudication_id', 'entity_id', 'status', 'provenance'],
    rejection: ['rejection_id', 'entity_id', 'stage', 'reason', 'provenance'],
  };
  if (!required[type]) throw new Error(`${context}: unknown record_type ${JSON.stringify(type)}`);
  requireFields(record, required[type], context);
  if (record.provenance && record.provenance.schema_version !== SCHEMA_VERSION) throw new Error(`${context}: provenance schema_version mismatch`);
  enumValue(record, 'benchmark_split', context); enumValue(record, 'capture_status', context); enumValue(record, 'identity_status', context); enumValue(record, 'mapping_confidence', context); enumValue(record, 'stage', context);
  if (type === 'capture_assignment' && (typeof record.capture_shard !== 'number' || typeof record.label_shard !== 'number' || typeof record.qa_overlap !== 'boolean')) throw new Error(`${context}: invalid shard assignment types`);
  if (type === 'visual_instance') {
    const box = record.instance_box;
    if (!box || typeof box !== 'object' || ['x', 'y', 'width', 'height'].some(key => typeof box[key] !== 'number' || box[key] < (key === 'x' || key === 'y' ? -Infinity : 0))) throw new Error(`${context}: invalid instance_box`);
  }
  return true;
}

export async function validateRun(runPath, { kind = 'all', strict = false } = {}) {
  const root = resolve(runPath);
  const benchmarkManifestPath = join(root, 'benchmark-manifest.json');
  const legacyManifestPath = join(root, 'manifest.json');
  const manifestPath = await fileExists(benchmarkManifestPath) ? benchmarkManifestPath : legacyManifestPath;
  if (!(await fileExists(manifestPath))) throw new Error(`Missing ${manifestPath}`);
  const manifest = await readJson(manifestPath);
  if (manifest.schema_version !== SCHEMA_VERSION || manifest.benchmark_version !== 1) throw new Error('Manifest schema/version is not visual-benchmark-v1.');
  await validateCaptureManifests(root);
  requireFields(manifest, ['fixture', 'seed', 'counts', 'entities', 'shards', 'overlap', 'assignment_digest'], 'manifest');
  if (typeof manifest.assignment_digest !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.assignment_digest)) throw new Error('manifest.assignment_digest must be a SHA-256 hex digest.');
  if (manifest.stages && typeof manifest.stages !== 'object') throw new Error('Manifest stages must be an object.');
  if (manifest.stages) {
    for (const [stage, descriptor] of Object.entries(manifest.stages)) {
      if (!descriptor || !['pending', 'running', 'complete', 'failed'].includes(descriptor.status)) throw new Error(`Invalid stage status for ${stage}.`);
      if (!Array.isArray(descriptor.required_files)) throw new Error(`Stage ${stage} required_files must be an array.`);
      for (const requiredFile of descriptor.required_files) {
        const requiredPath = confinedPath(root, requiredFile, `manifest.stages.${stage}.required_files`);
        if ((strict || descriptor.status === 'complete') && !(await fileExists(requiredPath))) throw new Error(`Stage ${stage} is complete but required evidence is missing: ${requiredFile}`);
      }
    }
  }
  const entities = manifest.entities;
  if (!Array.isArray(entities) || entities.length !== manifest.counts.total) throw new Error('Manifest entities/counts mismatch.');
  const entityIds = new Set();
  const assignmentById = new Map();
  for (const [index, assignment] of entities.entries()) {
    validateRecord({ schema_version: SCHEMA_VERSION, record_type: 'capture_assignment', ...assignment }, `manifest.entities[${index}]`);
    if (entityIds.has(assignment.entity_id)) throw new Error(`Duplicate entity_id ${assignment.entity_id}`);
    entityIds.add(assignment.entity_id); assignmentById.set(assignment.entity_id, assignment);
  }
  const computedDigest = assignmentDigest(entities, { seed: manifest.seed, fixtureSha256: manifest.fixture_sha256 ?? null, counts: manifest.counts });
  if (computedDigest !== manifest.assignment_digest) throw new Error('Manifest assignment_digest does not match entities, seed, fixture, or counts.');
  const splitCounts = { development: 0, validation: 0, evaluation: 0 };
  for (const assignment of entities) splitCounts[assignment.benchmark_split] += 1;
  for (const split of Object.keys(splitCounts)) if (splitCounts[split] !== manifest.counts[split]) throw new Error(`${split} count mismatch: manifest=${manifest.counts[split]}, observed=${splitCounts[split]}`);
  if (manifest.counts.total === 500 && (manifest.counts.development !== 300 || manifest.counts.validation !== 100 || manifest.counts.evaluation !== 100)) throw new Error('500-company benchmark must use a 300/100/100 split.');
  if (!Array.isArray(manifest.shards) || manifest.shards.length !== manifest.counts.shards) throw new Error('Manifest shard count mismatch.');
  const shardIds = new Set();
  const shardEntityIds = new Set();
  for (const shard of manifest.shards) {
    if (shardIds.has(shard.shard_id)) throw new Error(`Duplicate shard_id ${shard.shard_id}`);
    shardIds.add(shard.shard_id);
    if (shard.entity_count !== shard.entity_ids.length) throw new Error(`Shard ${shard.shard_id} entity_count mismatch.`);
    if (manifest.counts.total === 500 && shard.entity_count !== 50) throw new Error(`Shard ${shard.shard_id} must contain 50 entities.`);
    for (const id of shard.entity_ids) {
      if (!entityIds.has(id)) throw new Error(`Shard ${shard.shard_id} contains unknown entity ${id}`);
      if (shardEntityIds.has(id)) throw new Error(`Entity ${id} occurs in multiple shards.`);
      shardEntityIds.add(id);
      if (assignmentById.get(id).capture_shard !== shard.shard_id) throw new Error(`Entity ${id} has inconsistent capture_shard.`);
    }
    const shardOverlap = shard.overlap_entity_ids ?? [];
    if (new Set(shardOverlap).size !== shardOverlap.length) throw new Error(`Shard ${shard.shard_id} overlap contains duplicates.`);
    for (const id of shardOverlap) if (!shard.entity_ids.includes(id) || !assignmentById.get(id).qa_overlap) throw new Error(`Shard ${shard.shard_id} has invalid overlap entity ${id}.`);
  }
  if (shardEntityIds.size !== entityIds.size) throw new Error('Shard ownership is incomplete.');
  const overlap = new Set(manifest.overlap);
  if (overlap.size !== manifest.overlap.length || overlap.size !== manifest.counts.overlap) throw new Error('Manifest overlap contains duplicates or has the wrong count.');
  for (const id of overlap) if (!entityIds.has(id) || !assignmentById.get(id).qa_overlap) throw new Error(`Invalid overlap entity ${id}`);
  const shardOverlap = new Set(manifest.shards.flatMap(shard => shard.overlap_entity_ids ?? []));
  if (shardOverlap.size !== overlap.size || [...overlap].some(id => !shardOverlap.has(id))) throw new Error('Shard overlap ownership does not match manifest overlap.');
  for (const assignment of entities) if (assignment.qa_overlap !== overlap.has(assignment.entity_id)) throw new Error(`Entity ${assignment.entity_id} overlap flag mismatch.`);
  if (manifest.counts.total === 500 && overlap.size !== 100) throw new Error('500-company benchmark must have a deterministic 20% (100 entity) overlap.');
  const assignmentPaths = new Set();
  const labelPaths = new Set();
  const splitPaths = new Set();
  for (const shard of manifest.shards) {
    for (const [field, pathValue] of [['assignment_file', shard.assignment_file], ['label_file', shard.label_file], ['worker_manifest', shard.worker_manifest]]) {
      if (pathValue == null && field === 'worker_manifest') continue;
      const path = confinedPath(root, pathValue, `manifest.shards.${shard.shard_id}.${field}`);
      if (field === 'assignment_file') assignmentPaths.add(path);
      if (field === 'label_file') labelPaths.add(path);
    }
  }
  for (const [split, pathValue] of Object.entries(manifest.split_files ?? {})) splitPaths.add(confinedPath(root, pathValue, `manifest.split_files.${split}`));
  const workerManifests = [];
  for (const shard of manifest.shards) if (shard.worker_manifest) {
    const workerPath = confinedPath(root, shard.worker_manifest, `manifest.shards.${shard.shard_id}.worker_manifest`);
    if (await fileExists(workerPath)) {
      const worker = await readJson(workerPath);
      if (worker.assignment_digest !== manifest.assignment_digest) throw new Error(`Worker manifest ${shard.worker_manifest} has a mismatched assignment_digest.`);
      for (const [field, value] of [['benchmark_manifest', worker.benchmark_manifest], ['assignment_file', worker.assignment_file], ['output_directory', worker.output_directory]]) if (value != null) confinedPath(root, value, `${shard.worker_manifest}.${field}`);
      if (worker.shard_id !== shard.shard_id) throw new Error(`Worker manifest ${shard.worker_manifest} has a mismatched shard_id.`);
      if (!Array.isArray(worker.entity_ids) || worker.entity_ids.length !== shard.entity_count || worker.entity_ids.some(id => !shard.entity_ids.includes(id))) throw new Error(`Worker manifest ${shard.worker_manifest} does not own its declared shard.`);
      workerManifests.push(worker);
    }
  }
  const sources = [];
  const expectedByFile = new Map(manifest.shards.map(shard => [confinedPath(root, shard.assignment_file, `manifest.shards.${shard.shard_id}.assignment_file`), new Set(shard.entity_ids)]));
  if (kind === 'all' || kind === 'assignments') for (const shard of manifest.shards) sources.push(join(root, shard.assignment_file));
  const typedFiles = { capture: ['captures.jsonl'], entities: ['entities.jsonl'], candidates: ['candidates.jsonl'], instances: ['visual-instances.jsonl'], mappings: ['mappings.jsonl'], labels: ['labels.jsonl'], adjudications: ['adjudications.jsonl'], rejections: ['rejections.jsonl'] };
  if (kind !== 'all' && typedFiles[kind]) sources.push(...typedFiles[kind].map(file => join(root, file)));
  if (kind === 'all') for (const [typedKind, files] of Object.entries(typedFiles)) {
    // The shard assignment files and entities.jsonl are two views of the same
    // assignment set; scan the former above and avoid reporting intentional
    // duplicate assignment rows here.
    if (typedKind === 'entities') continue;
    sources.push(...files.map(file => join(root, file)));
  }
  // Include worker label/evidence files recursively, while keeping assignment
  // and split projections out of the typed-record stream.
  if (kind === 'all' || kind === 'labels' || kind === 'capture' || kind === 'candidates' || kind === 'instances' || kind === 'mappings' || kind === 'adjudications' || kind === 'rejections') {
    for (const file of await recursiveFiles(root, (path, name) => name.endsWith('.jsonl') && !assignmentPaths.has(path) && !splitPaths.has(path) && !path.endsWith('/entities.jsonl'))) sources.push(file);
  }
  const seen = new Map();
  const recordsByType = new Map();
  for (const file of [...new Set(sources)]) {
    // Capture and annotation stages are intentionally resumable; an absent
    // evidence file means that stage has not run yet, not that the assignment
    // manifest is invalid. `--strict` validates every file that is present.
    if (!(await fileExists(file))) continue;
    const rows = await readJsonl(file);
    const expected = expectedByFile.get(resolve(file));
    if (expected) {
      const actual = new Set(rows.map(({ row }) => row.entity_id));
      if (actual.size !== expected.size || [...expected].some(id => !actual.has(id))) throw new Error(`${file}: assignment rows do not match manifest shard ownership.`);
    }
    for (const { row, line } of rows) {
      validateRecord(row, `${file}:${line}`);
      if (row.entity_id && !entityIds.has(row.entity_id)) throw new Error(`${file}:${line}: unknown entity_id ${row.entity_id}`);
      const key = row.record_type === 'capture_assignment' ? `assignment:${row.entity_id}` : `${row.record_type}:${row[`${row.record_type}_id`] ?? row.label_id ?? row.candidate_id ?? row.entity_id}`;
      if (seen.has(key)) throw new Error(`Duplicate ${key} in ${file}:${line} (already in ${seen.get(key)}).`);
      seen.set(key, `${file}:${line}`);
      const typed = recordsByType.get(row.record_type) ?? new Map();
      typed.set(key, row);
      recordsByType.set(row.record_type, typed);
    }
  }
  for (const split of ['development', 'validation', 'evaluation']) {
    const splitPathValue = manifest.split_files?.[split];
    if (!splitPathValue) throw new Error(`Manifest is missing split_files.${split}.`);
    const splitPath = confinedPath(root, splitPathValue, `manifest.split_files.${split}`);
    if (!(await fileExists(splitPath))) throw new Error(`Missing split file ${splitPathValue}.`);
    const rows = await readJsonl(splitPath);
    const expected = entities.filter(row => row.benchmark_split === split);
    if (rows.length !== expected.length) throw new Error(`${splitPathValue}: expected ${expected.length} assignments, found ${rows.length}.`);
    const seenSplit = new Set();
    for (const { row, line } of rows) {
      validateRecord(row, `${splitPath}:${line}`);
      if (row.record_type !== 'capture_assignment' || row.benchmark_split !== split) throw new Error(`${splitPath}:${line}: row is not assigned to ${split}.`);
      if (seenSplit.has(row.entity_id) || !assignmentById.has(row.entity_id)) throw new Error(`${splitPath}:${line}: duplicate or unknown entity_id.`);
      if (!assignmentEquivalent(row, assignmentById.get(row.entity_id))) throw new Error(`${splitPath}:${line}: assignment differs from manifest.`);
      seenSplit.add(row.entity_id);
    }
  }
  const candidates = recordsByType.get('candidate') ?? new Map();
  const instances = recordsByType.get('visual_instance') ?? new Map();
  const candidateEntity = new Map([...candidates.values()].map(row => [row.candidate_id, row.entity_id]));
  const instanceEntity = new Map([...instances.values()].map(row => [row.visual_instance_id, row.entity_id]));
  for (const mapping of recordsByType.get('mapping')?.values() ?? []) {
    if (!instanceEntity.has(mapping.visual_instance_id)) throw new Error(`Mapping ${mapping.mapping_id} references missing visual_instance_id ${mapping.visual_instance_id}.`);
    if (mapping.candidate_id != null && !candidateEntity.has(mapping.candidate_id)) throw new Error(`Mapping ${mapping.mapping_id} references missing candidate_id ${mapping.candidate_id}.`);
    if (instanceEntity.get(mapping.visual_instance_id) !== mapping.entity_id) throw new Error(`Mapping ${mapping.mapping_id} crosses entity ownership.`);
    if (mapping.candidate_id != null && candidateEntity.get(mapping.candidate_id) !== mapping.entity_id) throw new Error(`Mapping ${mapping.mapping_id} candidate crosses entity ownership.`);
  }
  for (const label of recordsByType.get('label')?.values() ?? []) {
    const candidateId = label.candidate_id ?? (label.target_type === 'candidate' ? label.target_id : null);
    const instanceId = label.visual_instance_id ?? (label.target_type === 'visual_instance' ? label.target_id : null);
    if (candidateId != null && (!candidateEntity.has(candidateId) || candidateEntity.get(candidateId) !== label.entity_id)) throw new Error(`Label ${label.label_id} references missing or cross-entity candidate ${candidateId}.`);
    if (instanceId != null && (!instanceEntity.has(instanceId) || instanceEntity.get(instanceId) !== label.entity_id)) throw new Error(`Label ${label.label_id} references missing or cross-entity visual instance ${instanceId}.`);
  }
  const captures = recordsByType.get('entity_capture') ?? new Map();
  const labels = [...(recordsByType.get('label')?.values() ?? [])];
  const adjudications = [...(recordsByType.get('adjudication')?.values() ?? [])];
  const completeStage = stage => manifest.stages?.[stage]?.status === 'complete';
  if (completeStage('capture')) {
    for (const id of entityIds) if (!captures.has(`entity_capture:${id}`)) throw new Error(`Capture stage is complete but entity ${id} has no capture record.`);
  }
  if (completeStage('annotation')) {
    const labelsByEntity = new Map();
    for (const label of labels) {
      if (!label.reviewer_id || label.reviewer_id === 'unassigned' || !label.reviewer_kind || label.reviewer_kind === 'unassigned') throw new Error(`Annotation label ${label.label_id} has no assigned reviewer.`);
      if (!label.provenance?.capture_version || !label.provenance?.task_id) throw new Error(`Annotation label ${label.label_id} is missing capture_version or task_id provenance.`);
      const list = labelsByEntity.get(label.entity_id) ?? [];
      list.push(label); labelsByEntity.set(label.entity_id, list);
    }
    for (const id of entityIds) {
      const entityLabels = labelsByEntity.get(id) ?? [];
      if (!entityLabels.some(label => label.label_kind === 'entity')) throw new Error(`Annotation stage is complete but entity ${id} has no entity label.`);
      for (const candidate of [...candidates.values()].filter(row => row.entity_id === id)) if (!entityLabels.some(label => label.label_kind === 'candidate' && label.candidate_id === candidate.candidate_id)) throw new Error(`Entity ${id} candidate ${candidate.candidate_id} is unlabeled.`);
      for (const instance of [...instances.values()].filter(row => row.entity_id === id)) if (!entityLabels.some(label => label.label_kind === 'visual_instance' && label.visual_instance_id === instance.visual_instance_id)) throw new Error(`Entity ${id} visual instance ${instance.visual_instance_id} is unlabeled.`);
      const roleLabels = entityLabels.filter(label => label.label_kind === 'missing_role');
      const roles = new Set(roleLabels.map(label => label.role ?? label.values?.role));
      if (roles.size < 5) throw new Error(`Entity ${id} is missing one or more missing-role labels.`);
      if (assignmentById.get(id).qa_overlap && new Set(entityLabels.filter(label => label.label_kind === 'entity').map(label => label.reviewer_id)).size < 2) throw new Error(`Overlap entity ${id} lacks two independent entity reviews.`);
    }
  }
  if (completeStage('adjudication')) {
    for (const id of overlap) if (!adjudications.some(row => row.entity_id === id)) throw new Error(`Adjudication stage is complete but overlap entity ${id} has no adjudication.`);
  }
  const contentHashGroups = Array.isArray(manifest.content_hash_groups) ? manifest.content_hash_groups : [];
  const hashEntities = new Map();
  for (const candidate of candidates.values()) if (candidate.content_hash) {
    const list = hashEntities.get(candidate.content_hash) ?? [];
    list.push(candidate.entity_id); hashEntities.set(candidate.content_hash, list);
  }
  const contentHashLeaks = [];
  for (const [contentHash, ids] of hashEntities) {
    const uniqueIds = [...new Set(ids)];
    const splits = [...new Set(uniqueIds.map(id => assignmentById.get(id)?.benchmark_split).filter(Boolean))];
    if (splits.length > 1) {
      const group = contentHashGroups.find(item => Array.isArray(item.content_hashes) && item.content_hashes.includes(contentHash) && Array.isArray(item.entity_ids) && uniqueIds.every(id => item.entity_ids.includes(id)));
      contentHashLeaks.push({ content_hash: contentHash, entity_ids: uniqueIds.sort(), splits: splits.sort(), grouped: Boolean(group), group_id: group?.group_id ?? null });
      if (!group) throw new Error(`Content hash ${contentHash} crosses benchmark splits without a declared content_hash_group.`);
    }
  }
  const summary = { total: manifest.counts.total, splits: splitCounts, shards: manifest.shards.length, overlap: overlap.size, records: seen.size };
  if (contentHashLeaks.length) summary.content_hash_leaks = contentHashLeaks;
  return summary;
}

export async function main(argv = process.argv.slice(2)) {
  const args = argsOf(argv);
  if (!args.input && !args.run) throw new Error('Usage: visual-benchmark-validate.mjs --input <benchmark-run> [--kind all|assignments|candidates|instances|mappings|labels|adjudications|rejections] [--strict]');
  const summary = await validateRun(args.input ?? args.run, { kind: args.kind ?? 'all', strict: Boolean(args.strict) });
  process.stdout.write(`Validated ${summary.total} entities: ${summary.splits.development}/${summary.splits.validation}/${summary.splits.evaluation}, ${summary.shards} shards, ${summary.overlap} overlap, ${summary.records} records.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(`visual-benchmark-validate: ${error.message}`); process.exitCode = 1; });
