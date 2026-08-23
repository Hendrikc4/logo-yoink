import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { computeAgreement, cohenKappa, writeAgreementReports } from '../scripts/visual-benchmark-agreement.mjs';
import { REVIEW_VERSION, normalizeLabelRecord } from '../scripts/visual-benchmark-labels.mjs';

async function jsonl(path, rows) { await writeFile(path, rows.map(row => JSON.stringify(row)).join('\n') + '\n'); }

function label(reviewerId, reviewPass, labelKind, values, target = {}) {
  return normalizeLabelRecord({ label_kind: labelKind, entity_id: target.entityId, candidate_id: target.candidateId, visual_instance_id: target.visualInstanceId, role: target.role, values }, {
    runKey: 'test-run', captureKey: 'test-capture', reviewerId, reviewerKind: 'human', passId: reviewPass,
  });
}

async function fixture() {
  const run = await mkdtemp(join(tmpdir(), 'logo-yoink-agreement-'));
  await mkdir(join(run, 'shards', 'labels'), { recursive: true });
  await mkdir(join(run, 'reviews-round2'), { recursive: true });
  const entityId = 'entity-overlap';
  await writeFile(join(run, 'benchmark-manifest.json'), `${JSON.stringify({ assignment_digest: 'digest', overlap: [entityId], entities: [{ entity_id: entityId, qa_overlap: true }], shards: [{ shard_id: 0, label_file: 'shards/labels/primary.jsonl' }] })}\n`);
  await jsonl(join(run, 'candidates.jsonl'), [
    { schema_version: 'visual-benchmark-v1', record_type: 'candidate', candidate_id: 'candidate-a', entity_id: entityId },
    { schema_version: 'visual-benchmark-v1', record_type: 'candidate', candidate_id: 'candidate-b', entity_id: entityId },
  ]);
  await jsonl(join(run, 'visual-instances.jsonl'), [{ schema_version: 'visual-benchmark-v1', record_type: 'visual_instance', visual_instance_id: 'instance-a', entity_id: entityId }]);
  const targets = [
    ['entity', { entityId }],
    ['candidate', { entityId, candidateId: 'candidate-a' }],
    ['candidate', { entityId, candidateId: 'candidate-b' }],
    ['visual_instance', { entityId, visualInstanceId: 'instance-a' }],
    ...['icon', 'wide', 'favicon', 'stacked', 'other'].map(role => ['missing_role', { entityId, role }]),
  ];
  const primary = targets.map(([kind, target]) => label('reviewer-a', 'primary', kind, kind === 'entity'
    ? { identity_status: 'current', graphic_logo_present: 'true', text_only_brand_present: 'false' }
    : kind === 'candidate'
      ? { identity: target.candidateId === 'candidate-a' ? 'correct' : 'wrong', roles: ['wide', 'icon'], best_for_role: { wide: true, icon: false } }
      : kind === 'visual_instance'
        ? { identity: 'correct', visual_role: 'horizontal_lockup', first_party: 'yes' }
        : { missing_cause: target.role === 'wide' ? 'not_missing' : 'no_graphic_asset_exists' }, target));
  const qa = targets.map(([kind, target]) => label('reviewer-b', 'qa', kind, kind === 'entity'
    ? { identity_status: 'current', graphic_logo_present: 'true', text_only_brand_present: 'true' }
    : kind === 'candidate'
      ? { identity: target.candidateId === 'candidate-a' ? 'correct' : 'correct', roles: ['icon', 'wide'], best_for_role: { icon: false, wide: true } }
      : kind === 'visual_instance'
        ? { identity: 'correct', visual_role: 'horizontal_lockup', first_party: 'yes' }
        : { missing_cause: target.role === 'wide' ? 'not_missing' : 'no_graphic_asset_exists' }, target));
  await jsonl(join(run, 'shards', 'labels', 'primary.jsonl'), primary);
  await jsonl(join(run, 'reviews-round2', 'qa.jsonl'), qa);
  return { run, entityId, primary, qa };
}

test('agreement requires aligned complete targets and canonically compares structured values', async t => {
  const { run } = await fixture();
  t.after(() => rm(run, { recursive: true, force: true }));
  const report = await computeAgreement(run, { reviewerA: 'reviewer-a', reviewerB: 'reviewer-b' });
  assert.equal(report.scope.expected_targets, 9);
  assert.equal(report.scope.aligned_targets, 9);
  assert.deepEqual(report.reviewers.map(row => row.review_pass), ['primary', 'qa']);
  const roles = report.fields.find(field => field.label_kind === 'candidate' && field.field === 'roles');
  const bestFor = report.fields.find(field => field.label_kind === 'candidate' && field.field === 'best_for_role');
  assert.equal(roles.raw_agreement, 1);
  assert.equal(roles.kappa.status, 'exact_agreement_only');
  assert.equal(bestFor.raw_agreement, 1);
  assert.equal(bestFor.kappa.status, 'exact_agreement_only');
  const identity = report.fields.find(field => field.label_kind === 'candidate' && field.field === 'identity');
  assert.equal(identity.raw_agreement, 0.5);
  assert.equal(identity.kappa.status, 'computed');
  assert.equal(identity.kappa.value, 0);
});

test('agreement discovers canonical labels in independent review directories', async t => {
  const { run } = await fixture();
  t.after(() => rm(run, { recursive: true, force: true }));
  const report = await computeAgreement(run, { reviewerA: 'reviewer-a', reviewerB: 'reviewer-b' });
  assert.equal(report.scope.aligned_targets, 9);
  assert.equal(report.reviewers[1].review_pass, 'qa');
});

test('agreement rejects incomplete reviewer target coverage', async t => {
  const { run, qa } = await fixture();
  t.after(() => rm(run, { recursive: true, force: true }));
  await jsonl(join(run, 'reviews-round2', 'qa.jsonl'), qa.slice(0, -1));
  await assert.rejects(() => computeAgreement(run, { reviewerA: 'reviewer-a', reviewerB: 'reviewer-b' }), /does not have complete canonical target coverage: missing missing_role/);
});

test('agreement validates canonical target keys before comparison', async t => {
  const { run, qa } = await fixture();
  t.after(() => rm(run, { recursive: true, force: true }));
  qa[0].target_key = 'reviewer-dependent-target';
  await jsonl(join(run, 'reviews-round2', 'qa.jsonl'), qa);
  await assert.rejects(() => computeAgreement(run, { reviewerA: 'reviewer-a', reviewerB: 'reviewer-b' }), /target_key mismatch/);
});

test('positive-first agreement requires attestation and excludes it from semantic denominators', async t => {
  const { run, entityId, primary, qa } = await fixture();
  t.after(() => rm(run, { recursive: true, force: true }));
  for (const row of [...primary, ...qa]) row.provenance.prompt_version = REVIEW_VERSION;
  const attestation = (reviewerId, reviewPass) => normalizeLabelRecord({
    label_kind: 'review_attestation', entity_id: entityId,
    values: { visual_evidence_reviewed: true, review_workflow: 'positive_first', visual_instance_count: 1 },
    provenance: { schema_version: 'visual-benchmark-v1', capture_version: 'test-capture', task_id: 'agreement-test', prompt_version: REVIEW_VERSION },
  }, { runKey: 'test-run', captureKey: 'test-capture', reviewerId, reviewerKind: 'human', passId: reviewPass });
  await jsonl(join(run, 'shards', 'labels', 'primary.jsonl'), [...primary, attestation('reviewer-a', 'primary')]);
  await jsonl(join(run, 'reviews-round2', 'qa.jsonl'), [...qa, attestation('reviewer-b', 'qa')]);
  const report = await computeAgreement(run, { reviewerA: 'reviewer-a', reviewerB: 'reviewer-b' });
  assert.equal(report.scope.expected_targets, 9);
  assert.equal(report.scope.aligned_targets, 9);
  assert.deepEqual(report.attestation.reviewers.map(row => row.attestations), [1, 1]);
  assert.equal(report.attestation.excluded_from_semantic_agreement, true);
  assert.equal(report.fields.some(field => field.label_kind === 'review_attestation'), false);
  await jsonl(join(run, 'reviews-round2', 'qa.jsonl'), qa);
  await assert.rejects(() => computeAgreement(run, { reviewerA: 'reviewer-a', reviewerB: 'reviewer-b' }), /positive-first pass is missing review attestation/);
});

test('report writer emits both paths and refuses overwrite by default', async t => {
  const { run } = await fixture();
  t.after(() => rm(run, { recursive: true, force: true }));
  const report = await computeAgreement(run, { reviewerA: 'reviewer-a', reviewerB: 'reviewer-b' });
  const paths = await writeAgreementReports(report);
  assert.match(await readFile(paths.json, 'utf8'), /visual-benchmark-agreement-v1/);
  assert.match(await readFile(paths.markdown, 'utf8'), /Cohen's kappa/);
  await assert.rejects(() => writeAgreementReports(report), /Refusing to overwrite existing reports/);
  assert.deepEqual(await writeAgreementReports(report, { overwrite: true }), paths);
});

test('agreement CLI selects reviewers and prints both explicit report paths', async t => {
  const { run } = await fixture();
  t.after(() => rm(run, { recursive: true, force: true }));
  const json = join(run, 'custom', 'agreement.json'), markdown = join(run, 'custom', 'agreement.md');
  const command = [new URL('../scripts/visual-benchmark-agreement.mjs', import.meta.url).pathname, '--run', run, '--reviewer-a', 'reviewer-a', '--reviewer-b', 'reviewer-b', '--json', json, '--markdown', markdown];
  const first = spawnSync(process.execPath, command, { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(first.stdout.trim().split('\n'), [json, markdown]);
  const second = spawnSync(process.execPath, command, { encoding: 'utf8' });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /Refusing to overwrite existing reports/);
});

test('Cohen kappa reports degenerate and computed categorical samples honestly', () => {
  assert.deepEqual(cohenKappa(['same', 'same'], ['same', 'same']), { value: null, status: 'single_category', observed_agreement: 1, expected_agreement: 1, categories: 1 });
  assert.deepEqual(cohenKappa([], []), { value: null, status: 'insufficient_data' });
  assert.equal(cohenKappa(['a', 'a', 'b', 'b'], ['a', 'b', 'b', 'b']).status, 'computed');
});
