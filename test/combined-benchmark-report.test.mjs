import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCombinedBenchmark, parseCombinedArgs } from '../scripts/benchmark/combined-benchmark-report.mjs';

function result(entityId, candidateId, role, { duration = 1000 } = {}) {
  return {
    entity_id: entityId, name: entityId, website: `${entityId}.example`, status: 'success', reachability: 'live_html',
    candidates: [{ candidate_id: candidateId, predicted_roles: [role], squareish: role === 'icon', highResolution: true }],
    selected_by_role: { icon: role === 'icon' ? candidateId : null, wide: role === 'wide' ? candidateId : null, favicon: null },
    metrics: { duration_ms: duration, requests: 4, downloaded_bytes: 100_000, browser_used: false },
  };
}

async function jsonl(path, rows) {
  await writeFile(path, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
}

test('parses combined benchmark arguments', () => {
  assert.deepEqual(parseCombinedArgs(['--original-run', 'a', '--output=b']), {
    originalRun: 'a', output: 'b',
  });
});

test('scores the raw cohort union and frozen split projections', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logo-yoink-combined-'));
  const paths = Object.fromEntries(['or', 'ol', 'oa', 'ar', 'al', 'aa'].map(name => [name, join(directory, `${name}.jsonl`)]));
  const originalResults = [result('o-dev', 'oi', 'icon'), result('o-eval', 'ow', 'wide')];
  const additionalResults = [result('a-dev', 'ai', 'icon', { duration: 3000 }), result('a-eval', 'aw', 'wide', { duration: 3000 })];
  const labels = rows => rows.map(row => ({
    entity_id: row.entity_id, candidate_id: row.candidates[0].candidate_id, identity: 'correct', role: row.candidates[0].predicted_roles[0],
    usability: 'good', safety_class: 'correct_brand',
  }));
  const assignments = prefix => [
    { entity_id: `${prefix}-dev`, benchmark_split: 'development' },
    { entity_id: `${prefix}-eval`, benchmark_split: 'evaluation' },
  ];
  await Promise.all([
    jsonl(paths.or, originalResults), jsonl(paths.ol, labels(originalResults)), jsonl(paths.oa, assignments('o')),
    jsonl(paths.ar, additionalResults), jsonl(paths.al, labels(additionalResults)), jsonl(paths.aa, assignments('a')),
  ]);
  const report = await buildCombinedBenchmark({
    originalRun: paths.or, originalLabels: paths.ol, originalAssignments: paths.oa,
    additionalRun: paths.ar, additionalLabels: paths.al, additionalAssignments: paths.aa,
  });
  assert.equal(report.combined.domains.total, 4);
  assert.equal(report.combined.benchmarkScore.status, 'complete');
  assert.equal(report.splits.development.domains.total, 2);
  assert.equal(report.splits.evaluation.domains.total, 2);
  assert.equal(report.cohort_splits['original-500'].development.domains.total, 1);
  assert.equal(report.artifacts['major-brands-300'].run.sha256.length, 64);
});

test('rejects a result set that does not exactly match its frozen assignments', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logo-yoink-combined-invalid-'));
  const paths = Object.fromEntries(['or', 'ol', 'oa', 'ar', 'al', 'aa'].map(name => [name, join(directory, `${name}.jsonl`)]));
  const row = result('one', 'icon', 'icon');
  await Promise.all([
    jsonl(paths.or, [row]), jsonl(paths.ol, [{ entity_id: 'one', candidate_id: 'icon', identity: 'correct', role: 'icon', usability: 'good' }]), jsonl(paths.oa, [{ entity_id: 'different', benchmark_split: 'development' }]),
    jsonl(paths.ar, [result('two', 'wide', 'wide')]), jsonl(paths.al, [{ entity_id: 'two', candidate_id: 'wide', identity: 'correct', role: 'wide', usability: 'good' }]), jsonl(paths.aa, [{ entity_id: 'two', benchmark_split: 'development' }]),
  ]);
  await assert.rejects(buildCombinedBenchmark({
    originalRun: paths.or, originalLabels: paths.ol, originalAssignments: paths.oa,
    additionalRun: paths.ar, additionalLabels: paths.al, additionalAssignments: paths.aa,
  }), /exactly match frozen assignments/);
});
