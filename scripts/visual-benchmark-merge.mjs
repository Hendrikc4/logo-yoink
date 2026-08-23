#!/usr/bin/env node

import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readJsonl, validateRecord, validateRun } from './visual-benchmark-validate.mjs';
import { assignmentDigest, SCHEMA_VERSION, DEFAULT_SEED } from './visual-benchmark-shards.mjs';

function argsOf(argv) {
  const out = { _: [], input: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) { out._.push(token); continue; }
    const [key, inline] = token.slice(2).split('=', 2);
    if (key === 'input' || key === 'source') {
      const value = inline ?? argv[++i];
      if (!value) throw new Error('--input requires a path');
      out.input.push(value);
    } else if (inline !== undefined) out[key] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}
async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function writeJson(path, value) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
async function writeJsonl(path, rows) { await writeFile(path, rows.length ? `${rows.map(row => JSON.stringify(row)).join('\n')}\n` : '', 'utf8'); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function idFor(record) {
  const field = { capture_assignment: 'entity_id', entity_capture: 'entity_id', candidate: 'candidate_id', visual_instance: 'visual_instance_id', mapping: 'mapping_id', label: 'label_id', adjudication: 'adjudication_id', rejection: 'rejection_id' }[record.record_type];
  return `${record.record_type}:${record[field]}`;
}

async function sourceFiles(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
    }
  }
  await walk(root);
  return files.sort();
}

async function workerManifests(root) {
  const files = [];
  const captureFiles = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name === 'worker-manifest.json') files.push(path);
      else if (entry.isFile() && entry.name === 'capture-manifest.json') captureFiles.push(path);
    }
  }
  await walk(root);
  const selected = files.length ? files : captureFiles;
  return Promise.all(selected.sort().map(async path => ({ path, value: JSON.parse(await readFile(path, 'utf8')) })));
}

function confinedPath(root, value, context) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.startsWith('/') || /^[a-z]:/i.test(value)) throw new Error(`${context}: path must be relative to the benchmark root.`);
  const rootPath = resolve(root), target = resolve(rootPath, value), rel = relative(rootPath, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new Error(`${context}: path escapes benchmark root.`);
  return target;
}

function outputName(type) {
  return { entity_capture: 'captures.jsonl', candidate: 'candidates.jsonl', visual_instance: 'visual-instances.jsonl', mapping: 'mappings.jsonl', label: 'labels.jsonl', adjudication: 'adjudications.jsonl', rejection: 'rejections.jsonl' }[type];
}

export async function mergeRuns(sourcePaths, outputPath, { force = false } = {}) {
  const roots = sourcePaths.map(sourcePath => resolve(sourcePath));
  if (!roots.length) throw new Error('At least one source run is required.');
  const output = resolve(outputPath);
  if (await exists(join(output, 'benchmark-manifest.json')) && !force) throw new Error(`Refusing to overwrite ${output}; pass --force to replace it.`);
  const manifests = [];
  const assignments = new Map();
  const records = new Map();
  const recordSources = new Map();
  const ownedEntities = new Set();
  let assignmentDigestValue = null;
  for (const root of roots) {
    const manifestPath = join(root, 'benchmark-manifest.json');
    let sourceManifest = null;
    let sourceOwned = null;
    if (await exists(manifestPath)) {
      const manifest = await json(manifestPath);
      if (manifest.schema_version !== SCHEMA_VERSION) throw new Error(`${manifestPath}: unsupported schema_version`);
      const digest = manifest.assignment_digest ?? assignmentDigest(manifest.entities ?? [], { seed: manifest.seed, fixtureSha256: manifest.fixture_sha256 ?? null, counts: manifest.counts });
      if (assignmentDigestValue && digest !== assignmentDigestValue) throw new Error(`${manifestPath}: source manifests do not have identical assignment digests.`);
      assignmentDigestValue ??= digest;
      sourceManifest = manifest;
      manifests.push(manifest);
      for (const assignment of manifest.entities ?? []) {
        validateRecord({ schema_version: SCHEMA_VERSION, record_type: 'capture_assignment', ...assignment }, `${manifestPath}:${assignment.entity_id}`);
        if (!assignments.has(assignment.entity_id)) assignments.set(assignment.entity_id, assignment);
      }
      const workers = await workerManifests(root);
      if (workers.length) {
        sourceOwned = new Set();
        for (const worker of workers.map(item => item.value)) {
          if (worker.assignment_digest && worker.assignment_digest !== assignmentDigestValue) throw new Error(`${manifestPath}: worker manifest has a mismatched assignment_digest.`);
          for (const [field, value] of [['benchmark_manifest', worker.benchmark_manifest], ['assignment_file', worker.assignment_file], ['output_directory', worker.output_directory]]) if (value != null) confinedPath(root, value, `${manifestPath}:${field}`);
          if (!Array.isArray(worker.entity_ids)) throw new Error(`${manifestPath}: worker manifest entity_ids must be an array.`);
          for (const id of worker.entity_ids) {
            if (!assignments.has(id)) throw new Error(`${manifestPath}: worker owns unknown entity ${id}.`);
            if (sourceOwned.has(id)) throw new Error(`${manifestPath}: worker manifests overlap on entity ${id}.`);
            sourceOwned.add(id);
          }
        }
      }
    }
    if (!sourceOwned) sourceOwned = new Set(sourceManifest?.entities?.map(row => row.entity_id) ?? []);
    for (const id of sourceOwned) {
      if (ownedEntities.has(id)) throw new Error(`Duplicate/conflicting entity assignment ${id}: overlapping worker ownership; shard outputs must be disjoint.`);
      ownedEntities.add(id);
    }
    const files = await sourceFiles(root);
    for (const file of files) {
      // A generated run has the same assignment in manifest, entities.jsonl,
      // and capture shard files. The manifest is authoritative for ownership;
      // skip those views and only merge evidence/labels.
      const relativeFile = relative(root, file);
      if (basename(file) === 'entities.jsonl' || relativeFile.startsWith(`shards${sep}assignments${sep}`) || relativeFile.startsWith(`splits${sep}`)) continue;
      const rows = await readJsonl(file);
      for (const { row, line } of rows) {
        validateRecord(row, `${file}:${line}`);
        if (row.record_type === 'capture_assignment') {
          if (assignments.has(row.entity_id)) throw new Error(`Duplicate/conflicting entity assignment ${row.entity_id} in ${file}:${line}`);
          assignments.set(row.entity_id, row);
          continue;
        }
        if (row.entity_id && !sourceOwned.has(row.entity_id)) throw new Error(`${file}:${line}: record is outside this worker's owned entity set.`);
        const key = idFor(row);
        if (records.has(key)) throw new Error(`Duplicate/conflicting ${key}: ${recordSources.get(key)} and ${file}:${line}`);
        records.set(key, row); recordSources.set(key, `${file}:${line}`);
      }
    }
  }
  if (!assignments.size) throw new Error('No capture assignments found; refusing to create an unowned benchmark.');
  const first = manifests[0] ?? {};
  for (const manifest of manifests.slice(1)) {
    if (manifest.seed !== first.seed) throw new Error('Source manifests use different seeds.');
    if (manifest.benchmark_version !== first.benchmark_version) throw new Error('Source manifests use different benchmark versions.');
  }
  const sortedAssignments = [...assignments.values()].sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  const shardCount = Math.max(1, ...sortedAssignments.map(row => Number(row.capture_shard) + 1));
  const shardRows = Array.from({ length: shardCount }, () => []);
  for (const assignment of sortedAssignments) shardRows[assignment.capture_shard].push({ schema_version: SCHEMA_VERSION, record_type: 'capture_assignment', ...assignment });
  const overlap = sortedAssignments.filter(row => row.qa_overlap).map(row => row.entity_id).sort();
  const counts = { total: sortedAssignments.length, development: sortedAssignments.filter(row => row.benchmark_split === 'development').length, validation: sortedAssignments.filter(row => row.benchmark_split === 'validation').length, evaluation: sortedAssignments.filter(row => row.benchmark_split === 'evaluation').length, shards: shardCount, overlap: overlap.length };
  await mkdir(join(output, 'shards', 'assignments'), { recursive: true });
  await mkdir(join(output, 'shards', 'labels'), { recursive: true });
  await mkdir(join(output, 'splits'), { recursive: true });
  await mkdir(join(output, 'reports'), { recursive: true });
  for (let index = 0; index < shardRows.length; index += 1) await writeJsonl(join(output, 'shards', 'assignments', `capture-${String(index).padStart(2, '0')}.jsonl`), shardRows[index]);
  await writeJsonl(join(output, 'entities.jsonl'), sortedAssignments.map(row => ({ schema_version: SCHEMA_VERSION, record_type: 'capture_assignment', ...row })));
  for (const split of ['development', 'validation', 'evaluation']) await writeJsonl(join(output, 'splits', `${split}.jsonl`), sortedAssignments.filter(row => row.benchmark_split === split).map(row => ({ schema_version: SCHEMA_VERSION, record_type: 'capture_assignment', ...row })));
  const mergedAssignmentDigest = assignmentDigest(sortedAssignments, { seed: first.seed ?? DEFAULT_SEED, fixtureSha256: first.fixture_sha256 ?? null, counts });
  const shardDescriptors = shardRows.map((rows, shard_id) => ({ shard_id, assignment_file: `shards/assignments/capture-${String(shard_id).padStart(2, '0')}.jsonl`, label_file: `shards/labels/labels-${String(shard_id).padStart(2, '0')}.jsonl`, worker_manifest: `workers/capture-${String(shard_id).padStart(2, '0')}/worker-manifest.json`, entity_ids: rows.map(row => row.entity_id), entity_count: rows.length, overlap_entity_ids: rows.filter(row => row.qa_overlap).map(row => row.entity_id) }));
  for (const shard of shardDescriptors) await writeJsonl(join(output, shard.label_file), []);
  for (const shard of shardDescriptors) {
    await mkdir(join(output, 'workers', `capture-${String(shard.shard_id).padStart(2, '0')}`), { recursive: true });
    await writeJson(join(output, shard.worker_manifest), { schema_version: SCHEMA_VERSION, manifest_type: 'benchmark-worker-manifest', benchmark_version: 1, benchmark_manifest: 'benchmark-manifest.json', assignment_digest: mergedAssignmentDigest, worker_id: `capture-shard-${String(shard.shard_id).padStart(2, '0')}`, task_id: null, stage: 'capture', shard_id: shard.shard_id, entity_ids: shard.entity_ids, entity_count: shard.entity_count, assignment_file: shard.assignment_file, output_directory: `workers/capture-${String(shard.shard_id).padStart(2, '0')}` });
  }
  for (const type of ['entity_capture', 'candidate', 'visual_instance', 'mapping', 'label', 'adjudication', 'rejection']) {
    const rows = [...records.values()].filter(row => row.record_type === type);
    if (rows.length) await writeJsonl(join(output, outputName(type)), rows);
  }
  const manifest = { ...(first ?? {}), schema_version: SCHEMA_VERSION, benchmark_version: 1, fixture: first.fixture ?? 'merged', fixture_sha256: first.fixture_sha256 ?? hash(sortedAssignments.map(row => row.entity_id).join('\n')), assignment_digest: mergedAssignmentDigest, content_hash_groups: first.content_hash_groups ?? [], pilot_fixture: first.pilot_fixture ?? null, pilot_entity_ids: first.pilot_entity_ids ?? [], pilot_external_controls: first.pilot_external_controls ?? [], seed: first.seed ?? DEFAULT_SEED, generated_at: first.generated_at ?? '1970-01-01T00:00:00.000Z', counts, entities: sortedAssignments, shards: shardDescriptors, overlap, stages: first.stages ?? { assignment: { status: 'complete', required_files: ['entities.jsonl', ...shardDescriptors.flatMap(shard => [shard.assignment_file, shard.worker_manifest]) ] }, capture: { status: 'pending', required_files: [] }, annotation: { status: 'pending', required_files: [] }, adjudication: { status: 'pending', required_files: [] } }, provenance: first.provenance ?? { schema_version: SCHEMA_VERSION, capture_version: 'merge-v1' } };
  await writeJson(join(output, 'benchmark-manifest.json'), manifest);
  await validateRun(output);
  return { manifest, recordCount: records.size, sourceCount: roots.length };
}

export async function main(argv = process.argv.slice(2)) {
  const args = argsOf(argv);
  const output = args.output ?? args.out;
  const sourcePaths = [...args.input, ...args._];
  if (!output || !sourcePaths.length) throw new Error('Usage: visual-benchmark-merge.mjs --output <directory> --input <run> [--input <run> ...]');
  const result = await mergeRuns(sourcePaths, output, { force: Boolean(args.force) });
  process.stdout.write(`Merged ${result.sourceCount} source runs and ${result.recordCount} evidence/label records into ${resolve(output)}.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(`visual-benchmark-merge: ${error.message}`); process.exitCode = 1; });
