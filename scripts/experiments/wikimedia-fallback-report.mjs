#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) options[argv[index]?.replace(/^--/, '')] = argv[index + 1];
  if (!options.control || !options.treatment || !options.reviews || !options.split || !options.output) {
    throw new Error('Usage: wikimedia-fallback-report.mjs --control RUN --treatment RUN --reviews JSONL --split development|validation --output JSON');
  }
  return options;
}

async function text(path) { return readFile(resolve(path), 'utf8'); }
async function json(path) { return JSON.parse(await text(path)); }
async function jsonl(path) { return (await text(path)).split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
}
function aggregate(values) {
  const finite = values.filter(Number.isFinite);
  return { mean: finite.length ? Math.round(finite.reduce((a, b) => a + b, 0) / finite.length * 10) / 10 : null, p50: percentile(finite, .5), p95: percentile(finite, .95) };
}

const options = parseArgs(process.argv.slice(2));
if (!['development', 'validation'].includes(options.split)) throw new Error('Split must be development or validation.');
const controlPath = resolve(options.control, 'results.jsonl');
const treatmentPath = resolve(options.treatment, 'results.jsonl');
const [controlText, treatmentText, reviewsText] = await Promise.all([text(controlPath), text(treatmentPath), text(options.reviews)]);
const control = controlText.split(/\r?\n/).filter(Boolean).map(JSON.parse);
const treatment = treatmentText.split(/\r?\n/).filter(Boolean).map(JSON.parse);
const reviews = reviewsText.split(/\r?\n/).filter(Boolean).map(JSON.parse).filter(row => row.split === options.split);
const controlById = new Map(control.map(row => [row.entity_id, row]));
const reviewByKey = new Map(reviews.map(row => [`${row.entity_id}\0${row.role}\0${row.candidate_id}`, row]));
const selections = [];
for (const result of treatment) {
  for (const role of ['icon', 'wide']) {
    const candidateId = result.selected_by_role?.[role];
    const candidate = result.candidates?.find(item => item.candidate_id === candidateId);
    if (candidate?.source !== 'wikimedia-commons') continue;
    const review = reviewByKey.get(`${result.entity_id}\0${role}\0${candidateId}`);
    if (!review) throw new Error(`Missing delta review for ${result.entity_id} ${role} ${candidateId}.`);
    selections.push({ entity_id: result.entity_id, name: result.name, website: result.website, role, candidate_id: candidateId, commons_filename: candidate.evidence?.commons_filename, review });
  }
}
const firstPartyDisplacements = selections.filter(item => controlById.get(item.entity_id)?.selected_by_role?.[item.role]);
const correct = selections.filter(item => item.review.identity === 'correct' && item.review.role_correct === true);
const statusCounts = {};
for (const result of treatment) {
  const status = result.diagnostics?.wikimedia?.status ?? 'not_reached';
  statusCounts[status] = (statusCounts[status] ?? 0) + 1;
}
const activeStatuses = new Set(['ok', 'no_verified_current_logo', 'ambiguous_logo_claims', 'ambiguous_entities', 'no_search_candidates', 'unsafe_or_missing_commons_file', 'timeout', 'rate_limited', 'error']);
const attempts = treatment.filter(result => activeStatuses.has(result.diagnostics?.wikimedia?.status));
const technicalFailures = attempts.filter(result => ['timeout', 'rate_limited', 'error'].includes(result.diagnostics?.wikimedia?.status));
const performance = rows => ({
  latency_ms: aggregate(rows.map(row => row.metrics?.duration_ms)),
  requests: aggregate(rows.filter(row => row.status === 'success').map(row => row.metrics?.requests)),
  downloaded_bytes: aggregate(rows.filter(row => row.status === 'success').map(row => row.metrics?.downloaded_bytes)),
  extraction_failures: rows.filter(row => row.status !== 'success').length,
  extraction_failure_rate: rows.length ? rows.filter(row => row.status !== 'success').length / rows.length : null,
});
const splitPath = resolve('benchmarks/major-brands-300-v1/splits', `${options.split}.jsonl`);
const splitText = await text(splitPath);
const report = {
  schema_version: 1,
  split: options.split,
  frozen_inputs: {
    split_file: splitPath, split_sha256: hash(splitText),
    control_results: controlPath, control_sha256: hash(controlText),
    treatment_results: treatmentPath, treatment_sha256: hash(treatmentText),
    delta_reviews: resolve(options.reviews), delta_reviews_sha256: hash(reviewsText),
  },
  incremental_selections: {
    total: selections.length,
    correct: correct.length,
    icon_correct: correct.filter(item => item.role === 'icon').length,
    wide_correct: correct.filter(item => item.role === 'wide').length,
    strict_precision: selections.length ? correct.length / selections.length : null,
    wrong_brand: selections.filter(item => item.review.safety_class === 'wrong_brand').length,
    related_brand: selections.filter(item => item.review.safety_class === 'related_brand').length,
    first_party_displacements: firstPartyDisplacements.length,
    selections,
  },
  fallback: {
    attempts: attempts.length,
    status_counts: statusCounts,
    technical_failures: technicalFailures.length,
    technical_failure_rate: attempts.length ? technicalFailures.length / attempts.length : null,
  },
  performance: { control: performance(control), treatment: performance(treatment) },
  caveat: 'Control and treatment are separate live captures; reachability drift is disclosed by extraction failures. Incremental selection metrics count only selected Wikimedia candidates and never attribute unrelated first-party live drift to the fallback.',
};
await writeFile(resolve(options.output), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(`${options.split}: ${correct.length}/${selections.length} correct; ${(report.incremental_selections.strict_precision * 100).toFixed(2)}% strict precision`);
