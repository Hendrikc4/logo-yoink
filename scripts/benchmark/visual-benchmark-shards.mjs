#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, access, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCHEMA_VERSION = 'visual-benchmark-v1';
export const DEFAULT_SEED = 'logo-yoink-visual-benchmark-v1';

const ASSIGNMENT_FIELDS = ['entity_id', 'name', 'website', 'cohort', 'benchmark_split', 'capture_shard', 'label_shard', 'qa_overlap', 'pilot'];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function assignmentDigest(assignments, { seed = DEFAULT_SEED, fixtureSha256 = null, counts = null } = {}) {
  const rows = [...assignments]
    .map(row => Object.fromEntries(ASSIGNMENT_FIELDS.map(field => [field, row[field] ?? null])))
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  return sha256(canonicalJson({ benchmark_version: 1, seed, fixture_sha256: fixtureSha256, counts, assignments: rows }));
}

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

function stableCompare(a, b) {
  return a.key.localeCompare(b.key) || a.entity.entity_id.localeCompare(b.entity.entity_id);
}

export function assignBenchmark(companies, { seed = DEFAULT_SEED, shardCount = 10, overlapFraction = 0.2 } = {}) {
  if (!Array.isArray(companies) || !companies.length) throw new Error('companies must be a non-empty array');
  const ids = new Set();
  for (const company of companies) {
    if (!company || typeof company !== 'object' || !company.entity_id || !company.name || !company.website || !company.cohort) {
      throw new Error('Every company requires entity_id, name, website, and cohort.');
    }
    if (ids.has(company.entity_id)) throw new Error(`Duplicate entity_id: ${company.entity_id}`);
    ids.add(company.entity_id);
  }
  const ordered = companies.map(entity => ({ entity, key: sha256(`${seed}\0${entity.entity_id}`) })).sort(stableCompare);
  const n = ordered.length;
  const developmentCount = n === 500 ? 300 : Math.round(n * 0.6);
  const validationCount = n === 500 ? 100 : Math.round(n * 0.2);
  const splitByIndex = index => index < developmentCount ? 'development' : index < developmentCount + validationCount ? 'validation' : 'evaluation';
  const shardSize = Math.max(1, Math.ceil(n / shardCount));
  const assignments = ordered.map(({ entity }, index) => ({
    entity_id: entity.entity_id,
    name: entity.name,
    website: entity.website,
    cohort: entity.cohort,
    benchmark_split: splitByIndex(index),
    capture_shard: Math.min(shardCount - 1, Math.floor(index / shardSize)),
    label_shard: Math.min(shardCount - 1, Math.floor(index / shardSize)),
    qa_overlap: false,
    order: index,
  }));
  // Pick the same proportion inside every capture shard. This makes work
  // allocation predictable and avoids an overlap sample concentrated in one
  // split or one worker's directory.
  const byShard = new Map();
  for (const assignment of assignments) {
    if (!byShard.has(assignment.capture_shard)) byShard.set(assignment.capture_shard, []);
    byShard.get(assignment.capture_shard).push(assignment);
  }
  const targetOverlap = Math.round(n * overlapFraction);
  const overlapIds = [...assignments]
    .sort((a, b) => sha256(`${seed}\0overlap\0${a.entity_id}`).localeCompare(sha256(`${seed}\0overlap\0${b.entity_id}`)))
    .slice(0, targetOverlap)
    .map(assignment => { assignment.qa_overlap = true; return assignment.entity_id; });
  overlapIds.sort();
  return { assignments, overlapIds, counts: { total: n, development: developmentCount, validation: validationCount, evaluation: n - developmentCount - validationCount, shards: shardCount, overlap: overlapIds.length } };
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeJsonl(path, rows) {
  await writeFile(path, rows.length ? `${rows.map(row => JSON.stringify(row)).join('\n')}\n` : '', 'utf8');
}

export async function generateShards({ inputPath, outputPath, pilotPath = null, pilotOnly = false, cohort = 'all-500', seed = DEFAULT_SEED, resume = false, shardCount = 10 }) {
  const sourcePath = resolve(inputPath);
  const outputDirectory = resolve(outputPath);
  if (await exists(join(outputDirectory, 'benchmark-manifest.json')) && !resume) {
    throw new Error(`Refusing to overwrite frozen benchmark at ${outputDirectory}; pass --resume to regenerate.`);
  }
  const fixtureText = await readFile(sourcePath, 'utf8');
  const fixture = JSON.parse(fixtureText);
  const allCompanies = fixture.companies;
  if (!Array.isArray(allCompanies)) throw new Error('Input fixture must contain a companies array.');
  let companies = cohort === 'all-500' ? allCompanies.filter(company => company.cohort !== 'major-brands-300') :
    cohort === 'all-800' ? allCompanies : allCompanies.filter(company => company.cohort === cohort);
  if (!companies.length) throw new Error(`Fixture cohort '${cohort}' is empty or unknown.`);
  let pilot = null;
  if (pilotPath) {
    const pilotText = await readFile(resolve(pilotPath), 'utf8');
    pilot = JSON.parse(pilotText);
    const pilotRows = pilot.fixture_companies;
    if (!Array.isArray(pilotRows)) throw new Error('Pilot fixture must contain fixture_companies.');
    const companyById = new Map(companies.map(company => [company.entity_id, company]));
    const pilotIds = pilotRows.map(row => row.entity_id);
    for (const id of pilotIds) if (!companyById.has(id)) throw new Error(`Pilot entity is absent from company fixture: ${id}`);
    if (pilotOnly) companies = pilotIds.map(id => companyById.get(id));
  }
  const result = assignBenchmark(companies, { seed, shardCount });
  const pilotIds = new Set((pilot?.fixture_companies ?? []).map(row => row.entity_id));
  const assignments = result.assignments.map(({ order: _order, ...assignment }) => ({ ...assignment, pilot: pilotIds.has(assignment.entity_id) }));
  const counts = { ...result.counts };
  const fixtureSha256 = sha256(fixtureText);
  const digest = assignmentDigest(assignments, { seed, fixtureSha256, counts });
  const byShard = new Map();
  for (const assignment of assignments) {
    if (!byShard.has(assignment.capture_shard)) byShard.set(assignment.capture_shard, []);
    byShard.get(assignment.capture_shard).push(assignment);
  }
  await mkdir(join(outputDirectory, 'shards'), { recursive: true });
  await mkdir(join(outputDirectory, 'reports'), { recursive: true });
  const shards = [];
  for (let shardId = 0; shardId < shardCount; shardId += 1) {
    const shardAssignments = byShard.get(shardId) ?? [];
    const overlapEntityIds = shardAssignments.filter(row => row.qa_overlap).map(row => row.entity_id);
    const rows = shardAssignments.map(row => ({ schema_version: SCHEMA_VERSION, record_type: 'capture_assignment', ...row }));
    const captureFile = `shards/assignments/capture-${String(shardId).padStart(2, '0')}.jsonl`;
    const labelFile = `shards/labels/labels-${String(shardId).padStart(2, '0')}.jsonl`;
    const workerManifest = `workers/capture-${String(shardId).padStart(2, '0')}/worker-manifest.json`;
    await mkdir(join(outputDirectory, 'shards', 'assignments'), { recursive: true });
    await mkdir(join(outputDirectory, 'shards', 'labels'), { recursive: true });
    await writeJsonl(join(outputDirectory, captureFile), rows);
    await writeJsonl(join(outputDirectory, labelFile), []);
    shards.push({ shard_id: shardId, assignment_file: captureFile, label_file: labelFile, worker_manifest: workerManifest, entity_ids: shardAssignments.map(row => row.entity_id), entity_count: shardAssignments.length, overlap_entity_ids: overlapEntityIds });
    await mkdir(join(outputDirectory, 'workers', `capture-${String(shardId).padStart(2, '0')}`), { recursive: true });
    await writeJson(join(outputDirectory, workerManifest), {
      schema_version: SCHEMA_VERSION,
      manifest_type: 'benchmark-worker-manifest',
      benchmark_version: 1,
      benchmark_manifest: 'benchmark-manifest.json',
      assignment_digest: digest,
      worker_id: `capture-shard-${String(shardId).padStart(2, '0')}`,
      task_id: null,
      stage: 'capture',
      shard_id: shardId,
      entity_ids: shardAssignments.map(row => row.entity_id),
      entity_count: shardAssignments.length,
      assignment_file: captureFile,
      output_directory: `workers/capture-${String(shardId).padStart(2, '0')}`,
    });
  }
  const splitFiles = {};
  for (const split of ['development', 'validation', 'evaluation']) {
    splitFiles[split] = `splits/${split}.jsonl`;
    await mkdir(join(outputDirectory, 'splits'), { recursive: true });
    await writeJsonl(join(outputDirectory, splitFiles[split]), assignments.filter(row => row.benchmark_split === split).map(row => ({ schema_version: SCHEMA_VERSION, record_type: 'capture_assignment', ...row })));
  }
  await writeJsonl(join(outputDirectory, 'entities.jsonl'), assignments.map(row => ({ schema_version: SCHEMA_VERSION, record_type: 'capture_assignment', ...row })));
  const manifest = {
    schema_version: SCHEMA_VERSION,
    benchmark_version: 1,
    fixture: inputPath,
    fixture_cohort: cohort,
    fixture_sha256: fixtureSha256,
    pilot_fixture: pilotPath,
    pilot_entity_ids: [...pilotIds].sort(),
    pilot_external_controls: pilot?.external_positive_controls ?? [],
    seed,
    generated_at: fixture.generatedAt ?? '1970-01-01T00:00:00.000Z',
    counts,
    assignment_digest: digest,
    entities: assignments,
    shards,
    overlap: result.overlapIds,
    split_files: splitFiles,
    stages: {
      assignment: { status: 'complete', required_files: ['entities.jsonl', ...shards.flatMap(shard => [shard.assignment_file, shard.worker_manifest]), ...Object.values(splitFiles)] },
      capture: { status: 'pending', required_files: [] },
      annotation: { status: 'pending', required_files: [] },
      adjudication: { status: 'pending', required_files: [] },
    },
    content_hash_groups: [],
    provenance: { schema_version: SCHEMA_VERSION, capture_version: 'assignment-v1', extractor_revision: null, ranker_revision: null, task_id: null, model: null, prompt_version: null, captured_at: null },
  };
  await writeJson(join(outputDirectory, 'benchmark-manifest.json'), manifest);
  return manifest;
}

export async function main(argv = process.argv.slice(2)) {
  const args = argsOf(argv);
  const inputPath = args.input ?? args.fixture ?? 'fixtures/companies-500.json';
  const outputPath = args.output ?? args.out;
  if (!outputPath) throw new Error('Usage: visual-benchmark-shards.mjs --input <fixture> --output <directory> [--cohort all-500|all-800|COHORT] [--pilot <fixture>] [--pilot-only]');
  const manifest = await generateShards({ inputPath, outputPath, cohort: args.cohort ?? 'all-500', pilotPath: args.pilot ?? null, pilotOnly: Boolean(args['pilot-only']), seed: args.seed ?? DEFAULT_SEED, resume: Boolean(args.resume), shardCount: Number(args.shards ?? 10) });
  process.stdout.write(`Generated ${manifest.counts.total} assignments in ${manifest.shards.length} shards (${manifest.counts.development}/${manifest.counts.validation}/${manifest.counts.evaluation} split; ${manifest.counts.overlap} overlap).\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => { console.error(`visual-benchmark-shards: ${error.message}`); process.exitCode = 1; });
}
