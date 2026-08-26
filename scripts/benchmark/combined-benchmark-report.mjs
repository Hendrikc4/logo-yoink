#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeResults } from './benchmark.mjs';
import { RANKING_VERSION } from '../../src/rank.mjs';

const SPLITS = ['development', 'validation', 'evaluation'];

function help() {
  return `Combined Logo Yoink benchmark report

Usage:
  node scripts/benchmark/combined-benchmark-report.mjs \\
    --original-run RESULTS.jsonl --original-labels LABELS.jsonl \\
    --original-assignments ASSIGNMENTS.jsonl \\
    --additional-run RESULTS.jsonl --additional-labels LABELS.jsonl \\
    --additional-assignments ASSIGNMENTS.jsonl --output REPORT.json

The command scores each frozen cohort, each declared split, and their exact
union with the canonical benchmark scorer. It reads existing artifacts only.`;
}

export function parseCombinedArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--help') options.help = true;
    else if (argument.startsWith('--')) {
      const [rawKey, inline] = argument.slice(2).split(/=(.*)/s, 2);
      const key = rawKey.replace(/-([a-z])/g, (_, value) => value.toUpperCase());
      const value = inline ?? argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
      options[key] = value;
    } else throw new Error(`Unexpected argument: ${argument}`);
  }
  return options;
}

async function readJsonl(path) {
  const content = await readFile(path, 'utf8');
  return content.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`${path}:${index + 1}: ${error.message}`); }
  });
}

async function artifact(path) {
  const absolute = resolve(path);
  const bytes = await readFile(absolute);
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function exactEntitySet(results, assignments, name) {
  const resultIds = results.map(row => row.entity_id);
  const assignmentIds = assignments.map(row => row.entity_id);
  if (new Set(resultIds).size !== resultIds.length) throw new Error(`${name}: duplicate result entity_id`);
  if (new Set(assignmentIds).size !== assignmentIds.length) throw new Error(`${name}: duplicate assignment entity_id`);
  const expected = new Set(assignmentIds);
  const actual = new Set(resultIds);
  if (expected.size !== actual.size || [...expected].some(id => !actual.has(id))) {
    throw new Error(`${name}: results do not exactly match frozen assignments`);
  }
  for (const assignment of assignments) {
    if (!SPLITS.includes(assignment.benchmark_split)) throw new Error(`${name}: invalid benchmark split for ${assignment.entity_id}`);
  }
}

function labelsForResults(labels, results) {
  const ids = new Set(results.map(row => row.entity_id));
  return labels.filter(row => ids.has(row.entity_id));
}

function scoreProjection(results, labels, metadata) {
  return summarizeResults(results, metadata, labelsForResults(labels, results));
}

function metricSnapshot(summary) {
  const score = summary.benchmarkScore;
  return {
    assigned: summary.domains.total,
    reachable: summary.domains.reachable,
    reachable_rate: summary.domains.total ? summary.domains.reachable / summary.domains.total : null,
    score: score.value,
    score_status: score.status,
    points: score.points,
    icon: score.role_components.icon,
    wide: score.role_components.wide,
    wrong_brand_domains: score.safety.wrong_brand_domains,
    strict_selected_precision: score.labels.selected_roles
      ? (score.role_components.icon.top1_correctness.numerator + score.role_components.wide.top1_correctness.numerator) / score.labels.selected_roles
      : null,
    selected_slots: score.labels.selected_roles,
    p95_latency_ms: summary.performance.duration_ms.p95,
    mean_requests_per_reachable_domain: summary.performance.requests.mean,
    mean_downloaded_bytes_per_reachable_domain: summary.performance.downloaded_bytes.mean,
  };
}

function delta(additional, original) {
  const a = metricSnapshot(additional), o = metricSnapshot(original);
  return {
    score_points: a.score - o.score,
    reachable_rate_points: 100 * (a.reachable_rate - o.reachable_rate),
    icon_coverage_points: 100 * (a.icon.coverage.rate - o.icon.coverage.rate),
    icon_top1_points: 100 * (a.icon.top1_correctness.rate - o.icon.top1_correctness.rate),
    wide_coverage_points: 100 * (a.wide.coverage.rate - o.wide.coverage.rate),
    wide_top1_points: 100 * (a.wide.top1_correctness.rate - o.wide.top1_correctness.rate),
    strict_selected_precision_points: 100 * (a.strict_selected_precision - o.strict_selected_precision),
    p95_latency_ms: a.p95_latency_ms - o.p95_latency_ms,
  };
}

async function loadCohort(name, paths) {
  const [results, labels, assignments, runArtifact, labelArtifact, assignmentArtifact] = await Promise.all([
    readJsonl(resolve(paths.run)), readJsonl(resolve(paths.labels)), readJsonl(resolve(paths.assignments)),
    artifact(paths.run), artifact(paths.labels), artifact(paths.assignments),
  ]);
  exactEntitySet(results, assignments, name);
  const assignmentById = new Map(assignments.map(row => [row.entity_id, row]));
  const annotated = results.map(row => ({ ...row, benchmark_split: assignmentById.get(row.entity_id).benchmark_split }));
  const resultIds = new Set(annotated.map(row => row.entity_id));
  if (labels.some(row => row.entity_id && !resultIds.has(row.entity_id))) throw new Error(`${name}: label references an entity outside the cohort`);
  return { name, results: annotated, labels, artifacts: { run: runArtifact, labels: labelArtifact, assignments: assignmentArtifact } };
}

export async function buildCombinedBenchmark(options) {
  const original = await loadCohort('original-500', {
    run: options.originalRun, labels: options.originalLabels, assignments: options.originalAssignments,
  });
  const additional = await loadCohort('major-brands-300', {
    run: options.additionalRun, labels: options.additionalLabels, assignments: options.additionalAssignments,
  });
  const overlap = original.results.filter(row => additional.results.some(other => other.entity_id === row.entity_id));
  if (overlap.length) throw new Error(`Cohorts overlap at ${overlap[0].entity_id}`);

  const allResults = [...original.results, ...additional.results];
  const allLabels = [...original.labels, ...additional.labels];
  const originalSummary = scoreProjection(original.results, original.labels, { cohort: original.name });
  const additionalSummary = scoreProjection(additional.results, additional.labels, { cohort: additional.name });
  const combinedSummary = scoreProjection(allResults, allLabels, { cohort: 'all-800' });
  const cohorts = { [original.name]: originalSummary, [additional.name]: additionalSummary };
  const cohortSplits = Object.fromEntries([original, additional].map(cohort => [cohort.name,
    Object.fromEntries(SPLITS.map(split => {
      const results = cohort.results.filter(row => row.benchmark_split === split);
      return [split, scoreProjection(results, cohort.labels, { cohort: cohort.name, benchmark_split: split })];
    })),
  ]));
  const splits = Object.fromEntries(SPLITS.map(split => {
    const results = allResults.filter(row => row.benchmark_split === split);
    return [split, scoreProjection(results, allLabels, { cohort: 'all-800', benchmark_split: split })];
  }));

  for (const [surface, summary] of Object.entries({ combined: combinedSummary, ...cohorts, ...splits })) {
    if (summary.benchmarkScore.status !== 'complete') throw new Error(`${surface}: benchmark labels are incomplete`);
  }
  return {
    schema_version: 'logo-yoink-combined-benchmark-v1',
    generated_at: new Date().toISOString(),
    methodology: {
      current_runtime_ranking_version: RANKING_VERSION,
      canonical_roles: ['icon', 'wide'],
      population: 'All assigned entities are retained; quality denominators use reachable entities under the canonical scorer.',
      aggregation: 'Raw result and label rows are unioned, then scored once. Cohort scores are diagnostics, not inputs to an averaged score.',
      holdout_policy: 'Split assignments are frozen inputs. This command reports evaluation labels but exposes no tuning mechanism.',
      qualification: 'The report qualifies only the exact hashed cohort snapshots supplied to it. It does not imply that both snapshots used the current runtime ranking version.',
    },
    artifacts: { [original.name]: original.artifacts, [additional.name]: additional.artifacts },
    combined: combinedSummary,
    cohorts,
    splits,
    cohort_splits: cohortSplits,
    cohort_delta_additional_minus_original: delta(additionalSummary, originalSummary),
  };
}

async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, path);
}

async function main() {
  const options = parseCombinedArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(`${help()}\n`); return; }
  for (const field of ['originalRun', 'originalLabels', 'originalAssignments', 'additionalRun', 'additionalLabels', 'additionalAssignments', 'output']) {
    if (!options[field]) throw new Error(`Missing --${field.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)}`);
  }
  const report = await buildCombinedBenchmark(options);
  await writeAtomic(resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${resolve(options.output)}\ncombined benchmark score ${report.combined.benchmarkScore.value}/100\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`combined benchmark: ${error.message}\n`); process.exitCode = 1; });
}
