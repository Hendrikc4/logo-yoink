#!/usr/bin/env node

import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REVIEW_VERSION, ROLES, targetKeyFor, validateCanonicalLabel } from './visual-benchmark-labels.mjs';

const CATEGORICAL_SCALARS = new Set([
  'entity.identity_status', 'entity.graphic_logo_present', 'entity.text_only_brand_present',
  'candidate.identity', 'candidate.usability_light', 'candidate.usability_dark', 'candidate.provenance_quality',
  'visual_instance.identity', 'visual_instance.visual_role', 'visual_instance.region', 'visual_instance.theme',
  'visual_instance.visibility', 'visual_instance.first_party', 'visual_instance.mapping_confidence',
  'missing_role.missing_cause',
]);
const MISSING_VALUE = '\0visual-benchmark-missing';

function argsOf(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument ${token}`);
    const [rawKey, inline] = token.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (key === 'help' || key === 'overwrite') { out[key] = true; continue; }
    const value = inline ?? argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${rawKey}`);
    out[key] = value;
  }
  return out;
}

async function exists(path) { try { await access(path); return true; } catch { return false; } }

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`${path}: invalid JSON (${error.message})`); }
}

async function readJsonl(path) {
  const text = await readFile(path, 'utf8');
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try { return [{ row: JSON.parse(line), line: index + 1 }]; }
    catch (error) { throw new Error(`${path}:${index + 1}: invalid JSON (${error.message})`); }
  });
}

async function filesUnder(directory) {
  if (!(await exists(directory))) return [];
  const output = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) output.push(path);
    }
  }
  await walk(directory);
  return output.sort();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  return value;
}

function valueToken(value) { return JSON.stringify(stableValue(value)); }

export function cohenKappa(leftValues, rightValues) {
  if (leftValues.length !== rightValues.length || !leftValues.length) return { value: null, status: 'insufficient_data' };
  const left = leftValues.map(valueToken), right = rightValues.map(valueToken);
  const categories = [...new Set([...left, ...right])].sort();
  const observed = left.reduce((count, value, index) => count + Number(value === right[index]), 0) / left.length;
  const expected = categories.reduce((sum, category) => {
    const leftShare = left.filter(value => value === category).length / left.length;
    const rightShare = right.filter(value => value === category).length / right.length;
    return sum + leftShare * rightShare;
  }, 0);
  if (expected === 1) return { value: null, status: 'single_category', observed_agreement: observed, expected_agreement: expected, categories: categories.length };
  return { value: (observed - expected) / (1 - expected), status: 'computed', observed_agreement: observed, expected_agreement: expected, categories: categories.length };
}

function expectedTargets(entityIds, candidates, instances) {
  const targets = new Map();
  const add = descriptor => {
    const key = targetKeyFor(descriptor), prior = targets.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(descriptor)) throw new Error(`Canonical target_key collision between ${describeTarget(prior)} and ${describeTarget(descriptor)}.`);
    targets.set(key, descriptor);
  };
  for (const entityId of entityIds) {
    add({ labelKind: 'entity', entityId });
    for (const row of candidates.filter(candidate => candidate.entity_id === entityId)) add({ labelKind: 'candidate', entityId, candidateId: row.candidate_id });
    for (const row of instances.filter(instance => instance.entity_id === entityId)) add({ labelKind: 'visual_instance', entityId, visualInstanceId: row.visual_instance_id });
    for (const role of ROLES) add({ labelKind: 'missing_role', entityId, role });
  }
  return targets;
}

function reviewerRows(labels, reviewerId, overlap) {
  return labels.filter(label => label.reviewer_id === reviewerId && overlap.has(label.entity_id));
}

function reviewerPass(rows, reviewerId) {
  const passes = [...new Set(rows.map(row => row.review_pass))].sort();
  if (!rows.length) throw new Error(`Reviewer ${reviewerId} has no labels on manifest qa_overlap entities.`);
  if (passes.length !== 1) throw new Error(`Reviewer ${reviewerId} has multiple overlap review passes (${passes.join(', ')}); use a reviewer ID scoped to one pass.`);
  return passes[0];
}

function indexTargets(rows, reviewerId) {
  const output = new Map();
  for (const row of rows) {
    if (output.has(row.target_key)) throw new Error(`Reviewer ${reviewerId} has duplicate target_key ${row.target_key}.`);
    output.set(row.target_key, row);
  }
  return output;
}

function attestationSummary(rows, reviewerId, entityIds, instances) {
  const positiveFirst = rows.some(row => row.provenance?.prompt_version === REVIEW_VERSION);
  const attestations = rows.filter(row => row.label_kind === 'review_attestation');
  const byEntity = new Map();
  for (const row of attestations) {
    if (byEntity.has(row.entity_id)) throw new Error(`Reviewer ${reviewerId} has duplicate review attestation for ${row.entity_id}.`);
    byEntity.set(row.entity_id, row);
    const expectedCount = instances.filter(instance => instance.entity_id === row.entity_id).length;
    if (row.values.visual_instance_count !== expectedCount) throw new Error(`Reviewer ${reviewerId} review attestation for ${row.entity_id} has visual_instance_count ${row.values.visual_instance_count}; expected ${expectedCount}.`);
  }
  const missing = positiveFirst ? entityIds.filter(entityId => !byEntity.has(entityId)) : [];
  if (missing.length) throw new Error(`Reviewer ${reviewerId} positive-first pass is missing review attestation for ${missing.join(', ')}.`);
  return { reviewer_id: reviewerId, required: positiveFirst, attestations: attestations.length, represented_entities: entityIds.length, complete: missing.length === 0 && (!positiveFirst || attestations.length === entityIds.length) };
}

function describeTarget(descriptor) {
  return [descriptor.labelKind, descriptor.entityId, descriptor.candidateId, descriptor.visualInstanceId, descriptor.role].filter(Boolean).join(':');
}

function assertCoverage(index, expected, reviewerId) {
  const missing = [...expected].filter(([targetKey]) => !index.has(targetKey));
  const extra = [...index].filter(([targetKey]) => !expected.has(targetKey));
  if (missing.length || extra.length) {
    const details = [
      missing.length ? `missing ${missing.slice(0, 8).map(([, descriptor]) => describeTarget(descriptor)).join(', ')}${missing.length > 8 ? ` (+${missing.length - 8} more)` : ''}` : '',
      extra.length ? `unexpected ${extra.slice(0, 8).map(([, row]) => `${row.label_kind}:${row.entity_id}`).join(', ')}${extra.length > 8 ? ` (+${extra.length - 8} more)` : ''}` : '',
    ].filter(Boolean).join('; ');
    throw new Error(`Reviewer ${reviewerId} does not have complete canonical target coverage: ${details}.`);
  }
}

function valueType(values) {
  const types = new Set(values.map(value => Array.isArray(value) ? 'array' : value && typeof value === 'object' ? 'object' : typeof value));
  return types.size === 1 ? [...types][0] : 'mixed';
}

function fieldMetrics(left, right, targetKeys) {
  const groups = new Map();
  for (const targetKey of targetKeys) {
    const a = left.get(targetKey), b = right.get(targetKey);
    const fields = new Set([...Object.keys(a.values), ...Object.keys(b.values)]);
    for (const field of fields) {
      const key = `${a.label_kind}.${field}`;
      const group = groups.get(key) ?? { label_kind: a.label_kind, field, eligible_targets: 0, compared: 0, agreements: 0, missing_a: 0, missing_b: 0, both_missing: 0, left: [], right: [], observed: [], structured: false };
      group.eligible_targets += 1;
      const hasA = Object.prototype.hasOwnProperty.call(a.values, field), hasB = Object.prototype.hasOwnProperty.call(b.values, field);
      if (!hasA && !hasB) { group.both_missing += 1; groups.set(key, group); continue; }
      if (!hasA) group.missing_a += 1;
      if (!hasB) group.missing_b += 1;
      const valueA = hasA ? stableValue(a.values[field]) : MISSING_VALUE;
      const valueB = hasB ? stableValue(b.values[field]) : MISSING_VALUE;
      group.structured ||= [valueA, valueB].some(value => value !== MISSING_VALUE && (Array.isArray(value) || (value && typeof value === 'object')));
      group.compared += 1;
      group.agreements += Number(valueToken(valueA) === valueToken(valueB));
      group.left.push(valueA); group.right.push(valueB); group.observed.push(valueA, valueB);
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort((a, b) => `${a.label_kind}.${a.field}`.localeCompare(`${b.label_kind}.${b.field}`)).map(group => {
    const type = valueType(group.observed);
    const categorical = CATEGORICAL_SCALARS.has(`${group.label_kind}.${group.field}`) && !group.structured;
    return {
      label_kind: group.label_kind, field: group.field, value_type: type,
      eligible_targets: group.eligible_targets, compared: group.compared,
      agreements: group.agreements, disagreements: group.compared - group.agreements,
      raw_agreement: group.compared ? group.agreements / group.compared : null,
      missing_a: group.missing_a, missing_b: group.missing_b, both_missing: group.both_missing,
      kappa: categorical ? cohenKappa(group.left, group.right) : { value: null, status: group.structured ? 'exact_agreement_only' : 'not_categorical' },
    };
  });
}

async function loadRecordFile(path, recordType) {
  if (!(await exists(path))) throw new Error(`Missing required benchmark evidence file ${path}.`);
  return (await readJsonl(path)).filter(({ row }) => row.record_type === recordType).map(({ row }) => row);
}

async function labelFiles(run) {
  // Independent review passes are intentionally allowed to live outside the
  // primary shard paths (for example reviews-round2/). Discover JSONL files
  // once across the run, then retain and validate only label records below.
  const files = new Set(await filesUnder(run));
  if (!files.size) throw new Error(`No canonical label files found under ${run}.`);
  return [...files].sort();
}

export async function computeAgreement(runDirectory, { reviewerA, reviewerB } = {}) {
  if (!reviewerA || !reviewerB) throw new Error('Two reviewer IDs are required.');
  if (reviewerA === reviewerB) throw new Error('Reviewer IDs must be distinct.');
  const run = resolve(runDirectory), manifestPath = join(run, 'benchmark-manifest.json');
  const manifest = await readJson(manifestPath);
  const overlap = new Set(manifest.overlap ?? manifest.entities?.filter(row => row.qa_overlap).map(row => row.entity_id) ?? []);
  if (!overlap.size) throw new Error('Benchmark manifest has no qa_overlap entities.');
  const labels = [];
  for (const file of await labelFiles(run)) for (const { row, line } of await readJsonl(file)) {
    if (row.record_type !== 'label') continue;
    validateCanonicalLabel(row, `${file}:${line}`);
    labels.push(row);
  }
  const allA = reviewerRows(labels, reviewerA, overlap), allB = reviewerRows(labels, reviewerB, overlap);
  const passA = reviewerPass(allA, reviewerA), passB = reviewerPass(allB, reviewerB);
  const entitiesA = new Set(allA.map(row => row.entity_id));
  const entitiesB = new Set(allB.map(row => row.entity_id));
  const missingFromB = [...entitiesA].filter(entityId => !entitiesB.has(entityId)).sort();
  if (missingFromB.length) throw new Error(`Reviewer ${reviewerB} is missing reviewer ${reviewerA}'s qa_overlap entities: ${missingFromB.join(', ')}.`);
  const scope = [...entitiesA].sort();
  const rowsA = allA.filter(row => entitiesA.has(row.entity_id));
  const rowsB = allB.filter(row => entitiesA.has(row.entity_id));
  const candidates = await loadRecordFile(join(run, 'candidates.jsonl'), 'candidate');
  const instances = await loadRecordFile(join(run, 'visual-instances.jsonl'), 'visual_instance');
  const expected = expectedTargets(scope, candidates, instances);
  const attestations = [attestationSummary(rowsA, reviewerA, scope, instances), attestationSummary(rowsB, reviewerB, scope, instances)];
  const indexA = indexTargets(rowsA.filter(row => row.label_kind !== 'review_attestation'), reviewerA);
  const indexB = indexTargets(rowsB.filter(row => row.label_kind !== 'review_attestation'), reviewerB);
  assertCoverage(indexA, expected, reviewerA); assertCoverage(indexB, expected, reviewerB);
  const fields = fieldMetrics(indexA, indexB, [...expected.keys()].sort());
  const compared = fields.reduce((sum, field) => sum + field.compared, 0);
  const agreements = fields.reduce((sum, field) => sum + field.agreements, 0);
  return {
    schema_version: 'visual-benchmark-agreement-v1', generated_at: new Date().toISOString(),
    run_directory: run,
    benchmark: { assignment_digest: manifest.assignment_digest ?? null, manifest_overlap_entities: overlap.size },
    reviewers: [
      { reviewer_id: reviewerA, review_pass: passA, represented_overlap_entities: entitiesA.size },
      { reviewer_id: reviewerB, review_pass: passB, represented_overlap_entities: entitiesB.size },
    ],
    scope: { entity_ids: scope, entities: scope.length, expected_targets: expected.size, aligned_targets: expected.size, reviewer_b_additional_overlap_entities: [...entitiesB].filter(id => !entitiesA.has(id)).sort() },
    attestation: { excluded_from_semantic_agreement: true, reviewers: attestations },
    summary: { fields: fields.length, comparisons: compared, agreements, disagreements: compared - agreements, raw_agreement: compared ? agreements / compared : null },
    fields,
  };
}

function percent(value) { return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`; }
function decimal(value) { return value == null ? 'n/a' : value.toFixed(3); }
function cell(value) { return String(value).replaceAll('|', '\\|').replaceAll('\n', ' '); }

export function agreementMarkdown(report) {
  const [a, b] = report.reviewers;
  const rows = report.fields.map(field => `| ${cell(`${field.label_kind}.${field.field}`)} | ${field.compared} | ${field.agreements} | ${percent(field.raw_agreement)} | ${field.kappa.status === 'computed' ? decimal(field.kappa.value) : field.kappa.status} |`);
  const attestation = report.attestation?.reviewers?.map(item => `${item.reviewer_id}: ${item.attestations}/${item.represented_entities}${item.required ? ' required' : ' optional'}`).join('; ') ?? 'not reported';
  return `# Visual benchmark overlap agreement\n\n- Run: \`${report.run_directory}\`\n- Reviewer A: \`${a.reviewer_id}\` (pass \`${a.review_pass}\`)\n- Reviewer B: \`${b.reviewer_id}\` (pass \`${b.review_pass}\`)\n- Scope: ${report.scope.entities} overlap entities, ${report.scope.aligned_targets} aligned canonical targets\n- Overall exact agreement: ${percent(report.summary.raw_agreement)} across ${report.summary.comparisons} field comparisons\n- Review attestation: ${attestation}; excluded from semantic agreement\n\nArrays and objects use recursively sorted exact comparison. Kappa is reported only for declared categorical scalar fields; a single observed category is reported as undefined rather than as a misleading perfect score. Review-attestation bookkeeping is validated separately and excluded from all semantic agreement denominators.\n\n| Field | Compared | Agreements | Raw agreement | Cohen's kappa |\n|---|---:|---:|---:|---:|\n${rows.join('\n')}\n`;
}

function safeName(value) { return String(value).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'reviewer'; }

export async function writeAgreementReports(report, { jsonPath, markdownPath, overwrite = false } = {}) {
  const run = report.run_directory;
  const stem = `agreement-${safeName(report.reviewers[0].reviewer_id)}-vs-${safeName(report.reviewers[1].reviewer_id)}`;
  const json = resolve(jsonPath ?? join(run, 'reports', `${stem}.json`));
  const markdown = resolve(markdownPath ?? join(run, 'reports', `${stem}.md`));
  if (json === markdown) throw new Error('JSON and Markdown report paths must be different.');
  if (!overwrite) {
    const occupied = [];
    if (await exists(json)) occupied.push(json);
    if (await exists(markdown)) occupied.push(markdown);
    if (occupied.length) throw new Error(`Refusing to overwrite existing report${occupied.length > 1 ? 's' : ''}: ${occupied.join(', ')}. Pass --overwrite to replace.`);
  }
  await mkdir(dirname(json), { recursive: true }); await mkdir(dirname(markdown), { recursive: true });
  await writeFile(json, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' });
  await writeFile(markdown, agreementMarkdown(report), { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' });
  return { json, markdown };
}

export async function main(argv = process.argv.slice(2)) {
  const args = argsOf(argv);
  if (args.help) {
    process.stdout.write('Usage: visual-benchmark-agreement.mjs --run <benchmark-run> --reviewer-a <id> --reviewer-b <id> [--json <report.json>] [--markdown <report.md>] [--overwrite]\n');
    return;
  }
  if (!args.run || !args.reviewerA || !args.reviewerB) throw new Error('Usage: visual-benchmark-agreement.mjs --run <benchmark-run> --reviewer-a <id> --reviewer-b <id> [--json <report.json>] [--markdown <report.md>] [--overwrite]');
  const report = await computeAgreement(args.run, { reviewerA: args.reviewerA, reviewerB: args.reviewerB });
  const paths = await writeAgreementReports(report, { jsonPath: args.json, markdownPath: args.markdown, overwrite: args.overwrite });
  process.stdout.write(`${paths.json}\n${paths.markdown}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(`visual-benchmark-agreement: ${error.message}`); process.exitCode = 1; });
