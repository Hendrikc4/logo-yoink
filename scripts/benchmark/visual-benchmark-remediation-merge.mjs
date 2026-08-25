#!/usr/bin/env node

// An intentionally narrow overlay: it never writes either source run and does
// not make quality decisions.  The selection is the sole authority for which
// remediation captures replace base evidence.
import { access, cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJsonl, validateRun } from './visual-benchmark-validate.mjs';

const EVIDENCE = Object.freeze({
  captures: 'captures.jsonl', candidates: 'candidates.jsonl', visual_instances: 'visual-instances.jsonl', mappings: 'mappings.jsonl', rejections: 'rejections.jsonl',
});
const ID_FIELD = Object.freeze({ entity_capture: 'entity_id', candidate: 'candidate_id', visual_instance: 'visual_instance_id', mapping: 'mapping_id', rejection: 'rejection_id' });
const PATH_FIELDS = Object.freeze({ candidate: [['asset_path', 'asset'], ['preview_path', 'asset']], visual_instance: [['screenshot_path', 'capture'], ['overlay_path', 'capture'], ['crop_path', 'capture']] });

const exists = async path => { try { await access(path); return true; } catch { return false; } };
const digest = value => createHash('sha256').update(value).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const jsonl = async path => await exists(path) ? (await readJsonl(path)).map(({ row }) => row) : [];
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
const writeJsonl = (path, rows) => writeFile(path, rows.length ? `${rows.map(row => JSON.stringify(row)).join('\n')}\n` : '');

function under(root, value, context) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.startsWith('/') || /^[a-z]:/i.test(value)) throw new Error(`${context}: unsafe relative path`);
  const target = resolve(root, value); const rel = relative(resolve(root), target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new Error(`${context}: path escapes root`);
  return target;
}
function argsOf(argv) { const out = { input: [] }; for (let i = 0; i < argv.length; i += 1) { const token = argv[i]; if (!token.startsWith('--')) throw new Error(`Unexpected argument ${token}`); const [key, inline] = token.slice(2).split('=', 2); const value = inline ?? (argv[i + 1]?.startsWith('--') ? true : argv[++i]); if (key === 'input') out.input.push(value); else out[key] = value; } return out; }
function selectedIds(value) {
  const source = Array.isArray(value) ? value : value?.selected ?? value?.entity_ids ?? [];
  if (!Array.isArray(source)) throw new Error('selection must be an array or an object with selected/entity_ids');
  const ids = source.map(row => typeof row === 'string' ? row : row?.entity_id);
  if (ids.some(id => typeof id !== 'string' || !id)) throw new Error('selection contains an invalid entity_id');
  if (new Set(ids).size !== ids.length) throw new Error('selection contains duplicate entity_ids');
  return new Set(ids);
}
async function readSelection(path) {
  const text = await readFile(path, 'utf8');
  if (path.endsWith('.jsonl')) return selectedIds(text.split(/\r?\n/).filter(Boolean).map((line, i) => { try { return JSON.parse(line); } catch { throw new Error(`${path}:${i + 1}: invalid JSONL`); } }));
  return selectedIds(JSON.parse(text));
}
async function records(root) { const out = {}; for (const [key, file] of Object.entries(EVIDENCE)) out[key] = await jsonl(join(root, file)); return out; }
function summary(rows) { return Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.length])); }
function captureSummary(row) { if (!row) return null; const d = row.diagnostics ?? {}; return { capture_status: row.capture_status, identity_status: row.identity_status, reachability: row.reachability, resource_status: row.resource_status ?? null, truncation_reasons: d.truncation_reasons ?? [], candidate_count: row.candidate_count ?? null, visual_instance_count: row.visual_instance_count ?? null, mapping_count: row.mapping_count ?? null, rejection_count: row.rejection_count ?? null, artifact_failures: d.artifactFailures ?? d.artifact_failures ?? [], preview_failures: d.previewFailures ?? d.preview_failures ?? [], artifact_path: row.artifact_path ?? null }; }
function evidenceSummary(rows, entityId) { const subset = Object.fromEntries(Object.entries(rows).map(([kind, list]) => [kind, list.filter(row => row.entity_id === entityId)])); return { counts: summary(subset), candidate_ids: subset.candidates.map(row => row.candidate_id), content_hashes: subset.candidates.map(row => row.content_hash).filter(Boolean), paths: { captures: subset.captures.map(row => row.artifact_path).filter(Boolean), assets: subset.candidates.flatMap(row => [row.asset_path, row.preview_path]).filter(Boolean), screenshots: subset.visual_instances.flatMap(row => [row.screenshot_path, row.overlay_path, row.crop_path]).filter(Boolean) }, capture: captureSummary(subset.captures[0]) }; }

export async function validateRemediationInputs({ base, inputs, assignment = null }) {
  if (inputs.length !== 4) throw new Error('Exactly four --input worker directories are required.');
  const baseRoot = resolve(base); const baseManifest = await json(join(baseRoot, 'benchmark-manifest.json')); const baseIds = new Set(baseManifest.entities.map(row => row.entity_id));
  const assignmentRoot = assignment ? resolve(assignment) : null; const assignmentManifest = assignmentRoot ? await json(join(assignmentRoot, 'benchmark-manifest.json')) : null;
  if (assignmentManifest && assignmentManifest.source_benchmark?.assignment_digest !== baseManifest.assignment_digest) throw new Error('Remediation assignment is not bound to the supplied base assignment digest.');
  const assignmentIds = new Set(assignmentManifest?.entities?.map(row => row.entity_id) ?? []); const ownership = new Map(); const workers = [];
  for (const source of inputs) {
    const root = resolve(source); const manifestPath = join(root, 'capture-manifest.json'); const manifest = await json(manifestPath);
    if (manifest.schema_version !== baseManifest.schema_version || manifest.record_type !== 'capture_manifest' || manifest.benchmark_version !== 1) throw new Error(`${manifestPath}: incompatible capture manifest`);
    if (!Array.isArray(manifest.entity_ids) || manifest.entity_count !== manifest.entity_ids.length || manifest.assigned_count !== manifest.entity_count) throw new Error(`${manifestPath}: entity counts do not agree`);
    if (new Set(manifest.entity_ids).size !== manifest.entity_ids.length) throw new Error(`${manifestPath}: duplicate entity ownership`);
    if (!Array.isArray(manifest.completed_entity_ids) || manifest.completed_entity_ids.some(id => !manifest.entity_ids.includes(id))) throw new Error(`${manifestPath}: completed_entity_ids is invalid`);
    if (!manifest.aggregate_files || typeof manifest.aggregate_files !== 'object') throw new Error(`${manifestPath}: aggregate_files is required`);
    for (const [kind, filename] of Object.entries(EVIDENCE)) { if (manifest.aggregate_files[kind] !== filename) throw new Error(`${manifestPath}: aggregate_files.${kind} must be ${filename}`); under(root, filename, `${manifestPath}: aggregate file`); }
    if (assignmentRoot) {
      const expectedPath = resolve(root, manifest.assignment_manifest ?? ''); if (expectedPath !== join(assignmentRoot, 'benchmark-manifest.json')) throw new Error(`${manifestPath}: assignment_manifest does not point to supplied assignment root`);
      const assignmentBytes = await readFile(join(assignmentRoot, 'benchmark-manifest.json')); if (manifest.assignment_manifest_digest !== digest(assignmentBytes)) throw new Error(`${manifestPath}: assignment manifest digest mismatch`);
      for (const id of manifest.entity_ids) if (!assignmentIds.has(id)) throw new Error(`${manifestPath}: owns entity absent from remediation assignment: ${id}`);
      const workerManifest = await json(join(assignmentRoot, 'workers', basename(root), 'worker-manifest.json'));
      if (workerManifest.assignment_digest !== assignmentManifest.assignment_digest || workerManifest.entity_count !== manifest.entity_count || JSON.stringify(workerManifest.entity_ids) !== JSON.stringify(manifest.entity_ids)) throw new Error(`${manifestPath}: ownership does not match remediation worker manifest`);
    }
    for (const id of manifest.entity_ids) { if (!baseIds.has(id)) throw new Error(`${manifestPath}: owns entity absent from base: ${id}`); if (ownership.has(id)) throw new Error(`Duplicate remediation ownership for ${id}: ${ownership.get(id).root} and ${root}`); ownership.set(id, { root, manifest }); }
    const evidence = await records(root);
    for (const [kind, rows] of Object.entries(evidence)) for (const row of rows) if (!ownership.has(row.entity_id) || ownership.get(row.entity_id).root !== root) throw new Error(`${root}/${EVIDENCE[kind]}: record outside worker ownership: ${row.entity_id}`);
    workers.push({ root, manifest, evidence });
  }
  if (assignmentRoot && (ownership.size !== assignmentIds.size || [...assignmentIds].some(id => !ownership.has(id)))) throw new Error('Worker ownership does not exactly cover the remediation assignment.');
  return { baseRoot, baseManifest, baseIds, assignmentRoot, assignmentManifest, ownership, workers, baseEvidence: await records(baseRoot) };
}

export async function buildComparisonIndex(options) {
  const context = await validateRemediationInputs(options); const rows = [];
  for (const id of [...context.ownership.keys()].sort()) {
    const baseEntity = context.baseManifest.entities.find(row => row.entity_id === id); const retry = context.ownership.get(id); const retryEvidence = context.workers.find(worker => worker.root === retry.root).evidence;
    rows.push({ entity_id: id, name: baseEntity.name, website: baseEntity.website, benchmark_split: baseEntity.benchmark_split, worker: basename(retry.root), base: evidenceSummary(context.baseEvidence, id), retry: evidenceSummary(retryEvidence, id) });
  }
  const output = resolve(options.output); if (await exists(output)) throw new Error(`Comparison output already exists: ${output}`); await mkdir(output, { recursive: true });
  const index = { schema_version: 1, record_type: 'visual_benchmark_remediation_comparison', base: { path: context.baseRoot, assignment_digest: context.baseManifest.assignment_digest }, assignment: context.assignmentRoot ? { path: context.assignmentRoot, assignment_digest: context.assignmentManifest.assignment_digest } : null, worker_count: context.workers.length, entity_count: rows.length, entities: rows };
  await writeJson(join(output, 'comparison-index.json'), index); await writeJsonl(join(output, 'comparison-index.jsonl'), rows); return index;
}

async function verifyReferences(root, rows) {
  for (const row of rows.filter(row => row.record_type === 'entity_capture' && row.artifact_path)) {
    const path = under(root, row.artifact_path, 'entity_capture.artifact_path');
    if (!(await exists(path)) || !(await lstat(path)).isDirectory()) throw new Error(`entity_capture.artifact_path: referenced capture directory is missing: ${row.artifact_path}`);
  }
  for (const row of rows) for (const [field, kind] of PATH_FIELDS[row.record_type] ?? []) if (row[field]) {
    const value = row[field]; if (kind === 'asset' && !value.startsWith('assets/')) throw new Error(`${row.record_type}.${field}: not under assets/`); if (kind === 'capture' && !value.startsWith(`captures/${row.entity_id}/`)) throw new Error(`${row.record_type}.${field}: not under entity capture directory`);
    const path = under(root, value, `${row.record_type}.${field}`); if (!(await exists(path)) || !(await lstat(path)).isFile()) throw new Error(`${row.record_type}.${field}: referenced file is missing: ${value}`);
    if (row.record_type === 'candidate' && field === 'asset_path' && row.content_hash && digest(await readFile(path)) !== row.content_hash) throw new Error(`candidate.asset_path: content hash mismatch for ${value}`);
  }
}
function assertUnique(rows, label) { const seen = new Set(); for (const row of rows) { const key = `${row.record_type}:${row[ID_FIELD[row.record_type]]}`; if (seen.has(key)) throw new Error(`Duplicate ${label} record ID ${key}`); seen.add(key); } }
async function copyReferenced(source, staging, rows) { for (const row of rows) for (const [field] of PATH_FIELDS[row.record_type] ?? []) if (row[field]) { const value = row[field]; const from = under(source, value, field); const to = under(staging, value, field); await mkdir(dirname(to), { recursive: true }); if (await exists(to)) { const [a, b] = await Promise.all([readFile(from), readFile(to)]); if (!a.equals(b)) throw new Error(`Conflicting referenced asset bytes at ${value}`); } else await cp(from, to, { force: false, errorOnExist: true }); } }
async function assertSafeTree(root, directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { const path = join(directory, entry.name); const info = await lstat(path); if (info.isSymbolicLink()) throw new Error(`Capture tree contains a symlink: ${relative(root, path)}`); if (info.isDirectory()) await assertSafeTree(root, path); else if (!info.isFile()) throw new Error(`Capture tree contains a non-file artifact: ${relative(root, path)}`); } }

export async function overlayRemediationRuns({ base, inputs, selection, output, assignment = null, overwrite = false }) {
  const context = await validateRemediationInputs({ base, inputs, assignment }); const selected = await readSelection(selection);
  for (const id of selected) if (!context.baseIds.has(id) || !context.ownership.has(id)) throw new Error(`Selected entity is not in both base and exactly one remediation worker: ${id}`);
  const finalPath = resolve(output); if (await exists(finalPath) && !overwrite) throw new Error(`Refusing to overwrite existing output: ${finalPath}`);
  const staging = `${finalPath}.staging-${randomUUID()}`;
  try {
    await cp(context.baseRoot, staging, { recursive: true, errorOnExist: true, dereference: false });
    const retryByRoot = new Map(context.workers.map(worker => [worker.root, worker.evidence]));
    for (const [kind, filename] of Object.entries(EVIDENCE)) {
      const baseRows = context.baseEvidence[kind]; const retries = [...selected].flatMap(id => retryByRoot.get(context.ownership.get(id).root)[kind].filter(row => row.entity_id === id));
      await verifyReferences(context.baseRoot, baseRows); for (const root of new Set([...selected].map(id => context.ownership.get(id).root))) await verifyReferences(root, retryByRoot.get(root)[kind]);
      const combined = [...baseRows.filter(row => !selected.has(row.entity_id)), ...retries]; assertUnique(combined, kind); await writeJsonl(join(staging, filename), combined);
      await copyReferenced(context.baseRoot, staging, baseRows.filter(row => !selected.has(row.entity_id))); for (const id of selected) await copyReferenced(context.ownership.get(id).root, staging, retryByRoot.get(context.ownership.get(id).root)[kind].filter(row => row.entity_id === id));
    }
    for (const id of selected) { await rm(join(staging, 'captures', id), { recursive: true, force: true }); const source = context.ownership.get(id).root; const capture = join(source, 'captures', id); if (await exists(capture)) { await assertSafeTree(source, capture); await cp(capture, join(staging, 'captures', id), { recursive: true, errorOnExist: true, dereference: false }); } }
    const provenance = { schema_version: 1, record_type: 'visual_benchmark_remediation_overlay', base: { path: context.baseRoot, assignment_digest: context.baseManifest.assignment_digest }, selection_sha256: digest([...selected].sort().join('\n')), selected_entity_ids: [...selected].sort(), workers: context.workers.map(worker => ({ worker: basename(worker.root), path: worker.root, entity_ids: worker.manifest.entity_ids })) };
    await writeJson(join(staging, 'remediation-manifest.json'), provenance);
    await validateRun(staging, { strict: true });
    if (await exists(finalPath)) { if (!overwrite) throw new Error(`Refusing to overwrite existing output: ${finalPath}`); await rm(finalPath, { recursive: true, force: true }); }
    await rename(staging, finalPath); return provenance;
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}

export async function main(argv = process.argv.slice(2)) {
  const args = argsOf(argv); if (args.comparison) { const index = await buildComparisonIndex({ base: args.base, inputs: args.input, assignment: args.assignment, output: args.comparison }); process.stdout.write(`Wrote ${index.entity_count}-entity comparison index to ${resolve(args.comparison)}.\n`); return; }
  if (!args.base || !args.output || !args.selection) throw new Error('Usage: --base <run> --input <worker> (four times) --selection <json/jsonl> --output <new-run> [--assignment <root>] [--overwrite]');
  const result = await overlayRemediationRuns({ base: args.base, inputs: args.input, assignment: args.assignment, selection: args.selection, output: args.output, overwrite: args.overwrite === true }); process.stdout.write(`Atomically materialized ${result.selected_entity_ids.length} selected remediation overlays into ${resolve(args.output)}.\n`);
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(`visual-benchmark-remediation-merge: ${error.message}`); process.exitCode = 1; });
